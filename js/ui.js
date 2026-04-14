// UI rendering functions

const UI = {
  // ── SVG Calorie Ring ──

  renderCalorieRing(current, goal) {
    const radius = 70;
    const stroke = 10;
    const circumference = 2 * Math.PI * radius;
    const pct = Math.min(current / goal, 1.5);
    const offset = circumference - (Math.min(pct, 1) * circumference);
    const over = current > goal;
    const ringColor = over ? "#ef4444" : "#a3e635";
    const remaining = Math.max(goal - current, 0);

    return `
      <div class="calorie-ring-wrap">
        <svg class="calorie-ring" viewBox="0 0 ${(radius + stroke) * 2} ${(radius + stroke) * 2}">
          <circle
            cx="${radius + stroke}" cy="${radius + stroke}" r="${radius}"
            fill="none" stroke="#1a1a1a" stroke-width="${stroke}"
          />
          <circle
            class="calorie-ring-fill"
            cx="${radius + stroke}" cy="${radius + stroke}" r="${radius}"
            fill="none" stroke="${ringColor}" stroke-width="${stroke}"
            stroke-linecap="round"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            transform="rotate(-90 ${radius + stroke} ${radius + stroke})"
          />
        </svg>
        <div class="calorie-ring-text">
          <span class="cal-count ${over ? 'over' : ''}">${Math.round(current)}</span>
          <span class="cal-unit">kcal</span>
          <span class="cal-remaining">${over ? Math.round(current - goal) + ' over' : Math.round(remaining) + ' left'}</span>
        </div>
      </div>
    `;
  },

  // ── Nutrient Bars ──

  renderNutrientBars(totals) {
    return Object.entries(NUTRIENT_TARGETS)
      .filter(([key]) => key !== "calories")
      .map(([key, target]) => {
        const value = totals[key] || 0;
        const pct = Math.min((value / target.goal) * 100, 100);
        const over = target.direction === "max" && value > target.goal;
        const met = target.direction === "min" && value >= target.goal;
        let barColor = target.color;
        if (over) barColor = "#ef4444";
        if (met) barColor = "#a3e635";
        return `
          <div class="nutrient-row">
            <span class="nutrient-label">${target.label}</span>
            <div class="nutrient-bar-bg">
              <div class="nutrient-bar-fill" style="width:${pct}%; background:${barColor}"></div>
            </div>
            <span class="nutrient-value">${Math.round(value)}<span class="nutrient-sep">/</span>${target.goal}<span class="nutrient-unit">${target.unit}</span></span>
          </div>
        `;
      }).join('');
  },

  // ── Preset Chips ──

  renderPresetChips(customPresets) {
    const all = { ...DEFAULT_PRESETS, ...customPresets };
    return Object.entries(all).map(([key, p]) => {
      const emoji = p.emoji || "\u{1F37D}";
      return `<button class="preset-chip" data-key="${key}" title="${p.name} — ${p.portion}">${emoji} ${key}</button>`;
    }).join('');
  },

  // ── Entry Card ──

  renderEntry(entry, isToday) {
    const time = entry.time ? entry.time : '';
    const nutrients = [
      { value: entry.calories, unit: 'kcal', cls: 'cal' },
      { value: entry.protein, unit: 'g pro', cls: 'protein' },
      { value: entry.fiber, unit: 'g fib', cls: 'fiber' },
      { value: entry.saturated_fat, unit: 'g sf', cls: 'satfat' },
      { value: entry.sodium, unit: 'mg na', cls: 'sodium' },
      { value: entry.added_sugar, unit: 'g sug', cls: 'sugar' },
      { value: entry.vitamin_d, unit: 'IU D', cls: 'vitd' },
    ];

    return `
      <div class="entry-card" data-id="${entry.id}">
        <div class="entry-header">
          <div class="entry-info">
            <strong>${entry.name}</strong>
            <span class="entry-meta">
              ${entry.portion ? `${entry.portion}` : ''}
              ${time ? `<span class="entry-time">${time}</span>` : ''}
            </span>
          </div>
          ${isToday ? `<button class="delete-entry" data-id="${entry.id}" aria-label="Delete entry">&times;</button>` : ''}
        </div>
        <div class="entry-nutrients">
          ${nutrients
            .filter(n => n.value > 0)
            .map(n => `<span class="chip ${n.cls}">${Math.round(n.value)} ${n.unit}</span>`)
            .join('')}
        </div>
        ${entry.from_claude && isToday && !entry.preset_key ? `<button class="save-preset-btn" data-id="${entry.id}">&#x1F4BE; Save as shortcut</button>` : ''}
      </div>
    `;
  },

  // ── Input Area ──

  renderInputArea(customPresets) {
    return `
      <div class="input-area">
        <form id="food-input-form">
          <input type="text" id="food-input" placeholder="Type a food or preset name..." autocomplete="off">
          <label class="camera-btn" title="Add photo">
            <input type="file" id="photo-input" accept="image/*" capture="environment" hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </label>
          <button type="submit" class="add-btn">Add</button>
        </form>
        <div id="photo-preview" class="photo-preview" hidden></div>
        <div class="preset-chips">
          ${this.renderPresetChips(customPresets)}
        </div>
      </div>
    `;
  },

  // ── Full Page Render ──

  renderApp(state) {
    const { currentDate, entries, customPresets } = state;
    const totals = calcTotals(entries);
    const isToday = currentDate === todayString();

    return `
      <div class="app-shell">
        <header class="app-header">
          <h1>Burn Log</h1>
          <div class="date-nav">
            <button id="prev-day" aria-label="Previous day">&larr;</button>
            <span class="current-date">${formatDisplayDate(currentDate)}</span>
            <button id="next-day" aria-label="Next day" ${isToday ? 'disabled' : ''}>&rarr;</button>
            ${!isToday ? '<button id="today-btn">Today</button>' : ''}
          </div>
        </header>

        <div class="dashboard">
          ${this.renderCalorieRing(totals.calories, NUTRIENT_TARGETS.calories.goal)}
          <div class="nutrient-bars">
            ${this.renderNutrientBars(totals)}
          </div>
        </div>

        ${isToday ? this.renderInputArea(customPresets) : ''}

        <div class="entries-list">
          <h2>Entries${entries.length > 0 ? ` (${entries.length})` : ''}</h2>
          ${entries.length === 0
            ? `<p class="empty">${isToday ? 'No entries yet. Tap a chip or type a food above.' : 'No entries for this day.'}</p>`
            : entries.map(e => this.renderEntry(e, isToday)).join('')}
        </div>
      </div>
    `;
  }
};

// ── Pure helpers (used by UI and App) ──

function calcTotals(entries) {
  const totals = { calories: 0, fiber: 0, saturated_fat: 0, sodium: 0, protein: 0, added_sugar: 0, vitamin_d: 0 };
  for (const entry of entries) {
    for (const key of Object.keys(totals)) {
      totals[key] += entry[key] || 0;
    }
  }
  return totals;
}

function formatDisplayDate(dateStr) {
  if (dateStr === todayString()) return "Today";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
