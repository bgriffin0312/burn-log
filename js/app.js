// App initialization and state management
const App = {
  currentDate: todayString(),
  entries: [],
  burns: [],
  garminData: null,
  customPresets: {},
  burnPresets: {},
  photoFile: null,
  feedback: null,
  feedbackLoading: false,
  activeTab: "log",

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
      const [customPresetsData, entries, burns, garminData] = await Promise.all([
        getCustomPresets(),
        getEntriesForDate(this.currentDate),
        getBurnsForDate(this.currentDate),
        getGarminDaily(this.currentDate).catch(() => null)
      ]);

      this.customPresets = {};
      for (const p of customPresetsData) {
        this.customPresets[p.key] = p;
      }

      this.entries = entries;
      this.burns = burns;
      this.garminData = garminData;
      this.loadBurnPresets();
      await this.syncGarminBurns();
      this.render();

      // Track when the user started logging
      if (!localStorage.getItem("burnlog_start_date")) {
        localStorage.setItem("burnlog_start_date", todayString());
      }

      // Auto-show feedback on first load if we haven't shown it today
      if (CONFIG.CLAUDE_API_KEY) {
        const lastFeedback = localStorage.getItem("burnlog_last_feedback_date");
        if (lastFeedback !== todayString()) {
          this.requestFeedback();
        }
      }
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
      burns: this.burns,
      garminData: this.garminData,
      burnPresets: this.burnPresets,
      customPresets: this.customPresets,
      feedback: this.feedback,
      feedbackLoading: this.feedbackLoading,
      activeTab: this.activeTab
    });
    this.bindEvents();
  },

  bindEvents() {
    // Tab switching
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        this.activeTab = tab.dataset.tab;
        Charts.destroy();
        this.render();
        if (this.activeTab === "trends") {
          const container = document.getElementById("trends-container");
          if (container) Charts.loadTrends(container);
        }
      });
    });

    // CSV export
    document.getElementById("export-csv")?.addEventListener("click", () => Charts.exportCSV());

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

    // Burn entry form
    document.getElementById("burn-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("burn-input");
      const text = input.value.trim();
      if (!text) return;
      await this.handleBurnInput(text);
      input.value = "";
    });

    // Burn preset chips
    document.querySelectorAll(".burn-chip").forEach(chip => {
      chip.addEventListener("click", () => this.addBurnFromPreset(chip.dataset.key));
    });

    // Save burn as shortcut
    document.querySelectorAll(".save-burn-preset").forEach(btn => {
      btn.addEventListener("click", () => this.saveBurnAsPreset(btn.dataset.id));
    });

    // Delete burn buttons
    document.querySelectorAll(".delete-burn").forEach(btn => {
      btn.addEventListener("click", () => this.removeBurn(btn.dataset.id));
    });

    // Feedback button
    document.getElementById("feedback-btn")?.addEventListener("click", () => this.requestFeedback());
    document.getElementById("dismiss-feedback")?.addEventListener("click", () => {
      this.feedback = null;
      this.render();
    });

    // Settings: credentials form
    document.getElementById("settings-credentials")?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveConfig(
        document.getElementById("settings-supa-url").value.trim(),
        document.getElementById("settings-supa-key").value.trim(),
        document.getElementById("settings-claude-key").value.trim()
      );
      initSupabase();
      alert("Credentials saved.");
    });

    // Settings: targets form
    document.getElementById("settings-targets")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const inputs = document.querySelectorAll(".target-input");
      for (const input of inputs) {
        const metric = input.dataset.metric;
        const value = parseFloat(input.value);
        if (!isNaN(value) && value >= 0) {
          NUTRIENT_TARGETS[metric].goal = value;
          try { await updateDailyTarget(metric, value); } catch (err) {
            console.warn("Failed to sync target to DB:", metric, err);
          }
        }
      }
      alert("Targets saved.");
      this.render();
    });

    // Settings: delete custom preset
    document.querySelectorAll(".delete-custom-preset").forEach(btn => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.key;
        const id = btn.dataset.id;
        if (!confirm(`Delete preset "${key}"?`)) return;
        try {
          await deleteCustomPreset(id);
          delete this.customPresets[key];
          this.render();
        } catch (err) {
          console.error("Failed to delete preset:", err);
        }
      });
    });

    // Settings: Garmin manual entry form
    document.getElementById("garmin-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const steps = parseInt(document.getElementById("garmin-steps").value) || 0;
      const activeCal = parseFloat(document.getElementById("garmin-active-cal").value) || 0;
      const restingHr = parseInt(document.getElementById("garmin-resting-hr").value) || null;
      const sleepHours = parseFloat(document.getElementById("garmin-sleep").value) || null;
      const sleepScore = parseInt(document.getElementById("garmin-sleep-score").value) || null;
      const avgHrv = parseFloat(document.getElementById("garmin-hrv").value) || null;
      const bbHigh = parseInt(document.getElementById("garmin-bb-high").value) || null;
      const bbLow = parseInt(document.getElementById("garmin-bb-low").value) || null;

      try {
        const saved = await upsertGarminDaily({
          date: todayString(),
          total_steps: steps,
          active_calories: activeCal,
          resting_hr: restingHr,
          stress_avg: null,
          sleep_hours: sleepHours,
          sleep_score: sleepScore,
          avg_hrv: avgHrv,
          body_battery_high: bbHigh,
          body_battery_low: bbLow
        });
        this.garminData = saved;
        await this.syncGarminBurns();
        alert("Garmin data saved.");
        this.render();
      } catch (err) {
        console.error("Failed to save Garmin data:", err);
        alert("Failed to save: " + err.message);
      }
    });

    // Settings: export CSV
    document.getElementById("export-csv-settings")?.addEventListener("click", () => Charts.exportCSV());

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

  async handleBurnInput(text) {
    const key = text.toLowerCase().trim();

    // Check burn presets first
    if (this.burnPresets[key]) {
      await this.addBurnFromPreset(key);
      return;
    }

    // Claude estimation
    if (!CONFIG.CLAUDE_API_KEY) {
      alert("Claude API key not configured.");
      return;
    }

    const btn = document.querySelector(".burn-add-btn");
    const input = document.getElementById("burn-input");
    if (btn) { btn.disabled = true; btn.textContent = "..."; }
    if (input) input.disabled = true;

    try {
      const result = await estimateBurnWithClaude(text);
      await this.addBurn(result.name, result.calories, {
        activity_type: result.activity_type || "other",
        duration_mins: result.duration_mins || null,
        steps: result.steps || 0
      });
    } catch (err) {
      console.error("Burn estimation failed:", err);
      alert("Estimation failed: " + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "+"; }
      if (input) input.disabled = false;
    }
  },

  async addBurnFromPreset(key) {
    const preset = this.burnPresets[key];
    if (!preset) return;
    await this.addBurn(preset.name, preset.calories, {
      activity_type: preset.activity_type || "other",
      duration_mins: preset.duration_mins || null,
      steps: preset.steps || 0
    });
  },

  async addBurn(name, calories, extra) {
    try {
      const saved = await addBurnEntry({
        date: todayString(),
        time: nowTimeString(),
        name,
        calories,
        activity_type: extra?.activity_type || "other",
        duration_mins: extra?.duration_mins || null,
        steps: extra?.steps || 0,
        source: "manual"
      });
      this.burns.push(saved);
      this.render();
    } catch (err) {
      console.error("Failed to add burn:", err);
    }
  },

  async removeBurn(id) {
    try {
      await deleteBurnEntry(id);
      this.burns = this.burns.filter(b => b.id !== id);
      this.render();
    } catch (err) {
      console.error("Failed to delete burn:", err);
    }
  },

  saveBurnAsPreset(burnId) {
    const burn = this.burns.find(b => b.id === burnId);
    if (!burn) return;
    const suggested = burn.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const key = prompt("Shortcut name:", suggested);
    if (!key) return;
    this.burnPresets[key.toLowerCase().trim()] = {
      name: burn.name,
      calories: burn.calories,
      activity_type: burn.activity_type || "other",
      duration_mins: burn.duration_mins || null,
      steps: burn.steps || 0
    };
    localStorage.setItem("burnlog_burn_presets", JSON.stringify(this.burnPresets));
    this.render();
  },

  loadBurnPresets() {
    try {
      const saved = localStorage.getItem("burnlog_burn_presets");
      this.burnPresets = saved ? JSON.parse(saved) : {};
    } catch (e) {
      this.burnPresets = {};
    }
  },

  async syncGarminBurns() {
    if (!this.garminData) return;

    const activeCal = this.garminData.active_calories || 0;
    const steps = this.garminData.total_steps || 0;
    // Garmin replaces the 6k-step baseline with exact tracking.
    // If steps > 0, Garmin is tracking — use full active_calories.
    // If steps == 0 (watch not worn), subtract baseline to avoid double-counting.
    const extraCal = steps > 0
      ? activeCal
      : Math.max(0, activeCal - GARMIN_BASELINE_ACTIVE_CAL);
    if (extraCal <= 0) return;

    const existing = this.burns.find(b => b.source === "garmin");
    if (existing) {
      // Update if the calorie value changed (re-sync)
      if (Math.round(existing.calories) !== Math.round(extraCal) ||
          existing.steps !== (this.garminData.total_steps || 0)) {
        const { data, error } = await db
          .from("burn_entries")
          .update({
            calories: extraCal,
            steps: this.garminData.total_steps || 0,
            duration_mins: null
          })
          .eq("id", existing.id)
          .select();
        if (!error && data[0]) {
          const idx = this.burns.findIndex(b => b.id === existing.id);
          if (idx >= 0) this.burns[idx] = data[0];
        }
      }
    } else {
      // Create new garmin burn entry
      const saved = await addBurnEntry({
        date: this.garminData.date,
        time: "00:00",
        name: "Garmin Daily Activity",
        calories: extraCal,
        activity_type: "other",
        duration_mins: null,
        steps: this.garminData.total_steps || 0,
        source: "garmin"
      });
      this.burns.push(saved);
    }
  },

  async requestFeedback() {
    if (!CONFIG.CLAUDE_API_KEY || this.feedbackLoading) return;

    this.feedbackLoading = true;
    this.feedback = null;
    this.render();

    try {
      // Gather 7 days of data (yesterday is the focus, today is partial context)
      const today = todayString();
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const [allEntries, allBurns, garminDays] = await Promise.all([
        getEntriesForDateRange(sevenDaysAgo, today),
        getBurnsForDateRange(sevenDaysAgo, today),
        getGarminDailyRange(sevenDaysAgo, today).catch(() => [])
      ]);

      // Build per-day summaries (only flag missing days from start date onward)
      const startDate = localStorage.getItem("burnlog_start_date") || today;
      const days = {};
      const missingDays = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const dayEntries = allEntries.filter(e => e.date === d);
        const dayBurns = allBurns.filter(b => b.date === d);
        const totals = calcTotals(dayEntries);
        const burned = dayBurns.reduce((s, b) => s + (b.calories || 0), 0);

        if (dayEntries.length === 0 && d !== today && d >= startDate) {
          missingDays.push(d);
        }

        days[d] = {
          entries: dayEntries.length,
          ...totals,
          extra_burned: burned,
          net_calories: totals.calories - burned
        };
      }

      // Rolling averages (exclude today since it's incomplete)
      const pastDayValues = Object.entries(days)
        .filter(([d, v]) => d !== today && v.entries > 0)
        .map(([, v]) => v);
      const avg = {};
      if (pastDayValues.length > 0) {
        for (const key of ["calories", "fiber", "saturated_fat", "sodium", "protein", "added_sugar", "vitamin_d", "net_calories"]) {
          avg[key] = Math.round(pastDayValues.reduce((s, d) => s + (d[key] || 0), 0) / pastDayValues.length);
        }
        avg.days_logged = pastDayValues.length;
      }

      const yesterdayData = days[yesterday] || { entries: 0 };
      const todayData = days[today] || { entries: 0 };
      const yesterdayGarmin = garminDays.find(g => g.date === yesterday) || null;
      const todayGarmin = garminDays.find(g => g.date === today) || null;
      const weekData = { daily_averages: avg, target_calories: NUTRIENT_TARGETS.calories.goal, days };
      const result = await getDailyFeedback(yesterdayData, todayData, weekData, missingDays, yesterdayGarmin, todayGarmin);

      this.feedback = result;
      localStorage.setItem("burnlog_last_feedback_date", today);
    } catch (err) {
      console.error("Feedback failed:", err);
      this.feedback = { feedback: "Couldn't load feedback right now.", highlights: [], concerns: [] };
    } finally {
      this.feedbackLoading = false;
      this.render();
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
      const [entries, burns, garminData] = await Promise.all([
        getEntriesForDate(this.currentDate),
        getBurnsForDate(this.currentDate),
        getGarminDaily(this.currentDate).catch(() => null)
      ]);
      this.entries = entries;
      this.burns = burns;
      this.garminData = garminData;
      await this.syncGarminBurns();
      this.render();
    } catch (err) {
      console.error("Failed to load entries:", err);
      main.style.opacity = "1";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => App.init());
