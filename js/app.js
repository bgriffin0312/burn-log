// App initialization and state management
const App = {
  currentDate: todayString(),
  entries: [],
  customPresets: {},
  photoFile: null,

  async init() {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      this.showSetup();
      return;
    }

    try {
      if (!initSupabase()) {
        this.showSetup();
        return;
      }
    } catch (err) {
      console.error("Supabase init failed:", err);
      this.showSetup("Could not initialize Supabase. Check your credentials.");
      return;
    }

    try {
      const [customPresetsData, entries] = await Promise.all([
        getCustomPresets(),
        getEntriesForDate(this.currentDate)
      ]);

      this.customPresets = {};
      for (const p of customPresetsData) {
        this.customPresets[p.key] = p;
      }

      this.entries = entries;
      this.render();
    } catch (err) {
      console.error("Init failed:", err);
      this.showSetup("Connection failed: " + err.message);
    }
  },

  showSetup(errorMsg) {
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="setup-screen">
        <h1>Burn Log</h1>
        ${errorMsg ? `<p style="color:#ef4444;margin-bottom:8px">${errorMsg}</p>` : ''}
        <p>Enter your Supabase credentials to get started.</p>
        <form id="setup-form">
          <label>Supabase URL
            <input type="url" id="setup-url" placeholder="https://xxxxx.supabase.co" required>
          </label>
          <label>Supabase Anon Key
            <input type="text" id="setup-anon-key" placeholder="eyJhbGciOi..." required>
          </label>
          <label>Claude API Key <span class="optional">(optional)</span>
            <input type="text" id="setup-claude-key" placeholder="sk-ant-...">
          </label>
          <button type="submit">Connect</button>
        </form>
        <p class="setup-note">Get these from your Supabase project's Settings &gt; API page.</p>
      </div>
    `;
    document.getElementById("setup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      saveConfig(
        document.getElementById("setup-url").value.trim(),
        document.getElementById("setup-anon-key").value.trim(),
        document.getElementById("setup-claude-key").value.trim()
      );
      await this.init();
    });
  },

  render() {
    const main = document.getElementById("main");
    main.innerHTML = UI.renderApp({
      currentDate: this.currentDate,
      entries: this.entries,
      customPresets: this.customPresets
    });
    this.bindEvents();
  },

  bindEvents() {
    // Date navigation
    document.getElementById("prev-day")?.addEventListener("click", () => this.changeDate(-1));
    document.getElementById("next-day")?.addEventListener("click", () => this.changeDate(1));
    document.getElementById("today-btn")?.addEventListener("click", () => {
      this.currentDate = todayString();
      this.loadDate();
    });

    // Food input
    document.getElementById("food-input-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("food-input");
      const text = input.value.trim();
      if (!text && !this.photoFile) return;
      await this.handleFoodInput(text);
      input.value = "";
    });

    // Photo input
    document.getElementById("photo-input")?.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.photoFile = file;
      this.showPhotoPreview(file);
    });

    // Preset chips
    document.querySelectorAll(".preset-chip").forEach(chip => {
      chip.addEventListener("click", () => this.addPreset(chip.dataset.key));
    });

    // Delete buttons
    document.querySelectorAll(".delete-entry").forEach(btn => {
      btn.addEventListener("click", () => this.removeEntry(btn.dataset.id));
    });

    // Save as shortcut buttons
    document.querySelectorAll(".save-preset-btn").forEach(btn => {
      btn.addEventListener("click", () => this.saveAsPreset(btn.dataset.id));
    });

    // Swipe left/right for date navigation
    let touchStartX = 0;
    const shell = document.querySelector(".app-shell");
    if (shell) {
      shell.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });
      shell.addEventListener("touchend", (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 60) {
          this.changeDate(dx > 0 ? -1 : 1);
        }
      }, { passive: true });
    }
  },

  showPhotoPreview(file) {
    const preview = document.getElementById("photo-preview");
    if (!preview) return;
    const url = URL.createObjectURL(file);
    preview.innerHTML = `
      <img src="${url}" alt="Food photo">
      <button id="remove-photo" aria-label="Remove photo">&times;</button>
    `;
    preview.hidden = false;
    document.getElementById("remove-photo").addEventListener("click", () => {
      this.photoFile = null;
      preview.innerHTML = "";
      preview.hidden = true;
      document.getElementById("photo-input").value = "";
    });
  },

  async handleFoodInput(text) {
    const key = text.toLowerCase();
    const allPresets = { ...DEFAULT_PRESETS, ...this.customPresets };

    if (!this.photoFile && allPresets[key]) {
      await this.addPreset(key);
      return;
    }

    // Claude estimation
    if (!CONFIG.CLAUDE_API_KEY) {
      alert("Claude API key not configured. Add it in the setup screen.");
      return;
    }

    this.setLoading(true);
    try {
      const result = await estimateWithClaude(text, this.photoFile);
      this.photoFile = null;

      for (const item of result.items) {
        const entry = buildEntryFromClaude(item);
        const saved = await addFoodEntry(entry);
        this.entries.push(saved);
      }
      this.render();

      if (result.notes) {
        console.log("Claude notes:", result.notes);
      }
    } catch (err) {
      console.error("Claude estimation failed:", err);
      alert("Estimation failed: " + err.message);
    } finally {
      this.setLoading(false);
    }
  },

  setLoading(loading) {
    this.isLoading = loading;
    const btn = document.querySelector(".add-btn");
    const input = document.getElementById("food-input");
    if (btn) {
      btn.disabled = loading;
      btn.textContent = loading ? "..." : "Add";
    }
    if (input) input.disabled = loading;
  },

  async addPreset(key) {
    const allPresets = { ...DEFAULT_PRESETS, ...this.customPresets };
    const preset = allPresets[key];
    if (!preset) return;

    const entry = buildEntryFromPreset(key, preset);
    try {
      const saved = await addFoodEntry(entry);
      this.entries.push(saved);
      this.render();
    } catch (err) {
      console.error("Failed to add entry:", err);
    }
  },

  async removeEntry(id) {
    try {
      await deleteEntry(id);
      this.entries = this.entries.filter(e => e.id !== id);
      this.render();
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
  },

  async saveAsPreset(entryId) {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) return;

    const suggested = entry.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 3).join(' ');
    const key = prompt("Shortcut name:", suggested);
    if (!key) return;

    const preset = {
      key: key.toLowerCase().trim(),
      name: entry.name,
      portion: entry.portion || "",
      calories: entry.calories || 0,
      fiber: entry.fiber || 0,
      saturated_fat: entry.saturated_fat || 0,
      sodium: entry.sodium || 0,
      protein: entry.protein || 0,
      added_sugar: entry.added_sugar || 0,
      vitamin_d: entry.vitamin_d || 0,
      emoji: "\u{1F37D}"
    };

    try {
      const saved = await saveCustomPreset(preset);
      this.customPresets[saved.key] = saved;
      this.render();
    } catch (err) {
      console.error("Failed to save preset:", err);
      alert("Failed to save shortcut: " + err.message);
    }
  },

  async changeDate(offset) {
    const d = new Date(this.currentDate + "T12:00:00");
    d.setDate(d.getDate() + offset);
    const newDate = d.toISOString().slice(0, 10);
    // Don't navigate into the future
    if (newDate > todayString()) return;
    this.currentDate = newDate;
    await this.loadDate();
  },

  async loadDate() {
    const main = document.getElementById("main");
    main.style.opacity = "0.5";
    try {
      this.entries = await getEntriesForDate(this.currentDate);
      this.render();
    } catch (err) {
      console.error("Failed to load entries:", err);
      main.style.opacity = "1";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => App.init());
