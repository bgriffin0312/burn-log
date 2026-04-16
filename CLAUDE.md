# CLAUDE.md — Burn Log: Nutrition Tracker PWA

## Project Overview

Burn Log is a personal nutrition tracking Progressive Web App (PWA) for a 49-year-old man (5'10", 215 lbs) managing weight loss, high cholesterol (LDL 148), borderline A1C (5.6), and low vitamin D (19 ng/mL). The app tracks calories and key nutrients against daily targets, supports photo-based food estimation via the Claude API, and stores everything in Supabase so it's accessible from any device.

## Architecture

- **Frontend:** Single-page static PWA (vanilla HTML/CSS/JS, no framework)
- **Database:** Supabase (Postgres) — free tier
- **AI:** Anthropic Claude API (claude-sonnet-4-20250514) for food photo/text estimation
- **Hosting:** GitHub Pages (free)
- **Auth:** None for v1 — single-user app secured by Supabase anon key + row-level security

## Tech Stack

- Vanilla JS (ES6+), no build tools
- Supabase JS client (CDN: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2)
- Chart.js (CDN: https://cdn.jsdelivr.net/npm/chart.js) for trend charts
- PWA with service worker for offline support and home screen install
- Claude API called directly from browser (user provides their own API key or uses the built-in artifact key pattern)

## File Structure

```
burn-log/
├── index.html            # Single-page app shell
├── css/
│   └── style.css         # Dark theme, mobile-first responsive
├── js/
│   ├── app.js            # App initialization, routing, state management
│   ├── config.js          # Supabase URL/key, Claude config, nutrient targets
│   ├── db.js              # Supabase CRUD operations
│   ├── presets.js          # Default preset foods (hardcoded)
│   ├── claude.js           # Claude API integration for food estimation
│   ├── ui.js               # All DOM rendering functions
│   └── charts.js           # Chart.js trend visualizations
├── sw.js                   # Service worker
├── manifest.json           # PWA manifest
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── CLAUDE.md               # This file
└── README.md               # Setup instructions
```

## Supabase Schema

Run this SQL in the Supabase SQL editor to create tables:

```sql
-- Food log entries
CREATE TABLE food_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT,
  name TEXT NOT NULL,
  portion TEXT,
  calories REAL DEFAULT 0,
  fiber REAL DEFAULT 0,
  saturated_fat REAL DEFAULT 0,
  sodium REAL DEFAULT 0,
  protein REAL DEFAULT 0,
  added_sugar REAL DEFAULT 0,
  vitamin_d REAL DEFAULT 0,
  preset_key TEXT,
  from_claude BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast day lookups
CREATE INDEX idx_food_entries_date ON food_entries(date);

-- User-defined preset foods (supplements the hardcoded defaults)
CREATE TABLE custom_presets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  portion TEXT,
  calories REAL DEFAULT 0,
  fiber REAL DEFAULT 0,
  saturated_fat REAL DEFAULT 0,
  sodium REAL DEFAULT 0,
  protein REAL DEFAULT 0,
  added_sugar REAL DEFAULT 0,
  vitamin_d REAL DEFAULT 0,
  emoji TEXT DEFAULT '🍽',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily targets (so they can be adjusted over time)
CREATE TABLE daily_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric TEXT UNIQUE NOT NULL,
  goal REAL NOT NULL,
  unit TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('min', 'max')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default targets
INSERT INTO daily_targets (metric, goal, unit, direction) VALUES
  ('calories', 1680, 'kcal', 'max'),
  ('fiber', 38, 'g', 'min'),
  ('saturated_fat', 16, 'g', 'max'),
  ('sodium', 1800, 'mg', 'max'),
  ('protein', 140, 'g', 'min'),
  ('added_sugar', 36, 'g', 'max'),
  ('vitamin_d', 600, 'IU', 'min');

-- Row Level Security (basic — allows all operations with anon key)
ALTER TABLE food_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on food_entries" ON food_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on custom_presets" ON custom_presets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on daily_targets" ON daily_targets FOR ALL USING (true) WITH CHECK (true);
```

## Hardcoded Default Presets

These live in `js/presets.js` and are available without any database call. When a user types one of these shortcut keys, the entry is logged instantly with no API call.

```javascript
const DEFAULT_PRESETS = {
  "smoothie": {
    name: "Smoothie (OJ/banana/blueberry/chia/yogurt)",
    portion: "full recipe",
    calories: 665, fiber: 21.2, saturated_fat: 7, sodium: 115,
    protein: 18.5, added_sugar: 0, vitamin_d: 190, emoji: "🥤"
  },
  "crackers": {
    name: "Good Thins Corn & Rice",
    portion: "8 crackers",
    calories: 25, fiber: 0.2, saturated_fat: 0, sodium: 38,
    protein: 0.4, added_sugar: 0, vitamin_d: 0, emoji: "🍞"
  },
  "pineapple": {
    name: "Fresh Pineapple",
    portion: "~1 cup chunks",
    calories: 82, fiber: 2.3, saturated_fat: 0, sodium: 2,
    protein: 0.9, added_sugar: 0, vitamin_d: 0, emoji: "🍍"
  },
  "stew": {
    name: "Pork & Cabbage Stew w/ Cheddar Dumplings",
    portion: "1 serving (1/6)",
    calories: 465, fiber: 4, saturated_fat: 12, sodium: 680,
    protein: 28, added_sugar: 0, vitamin_d: 15, emoji: "🍲"
  },
  "salmon": {
    name: "Roasted Salmon",
    portion: "~6oz fillet",
    calories: 350, fiber: 0, saturated_fat: 3, sodium: 80,
    protein: 38, added_sugar: 0, vitamin_d: 450, emoji: "🐟"
  },
  "pepper beef": {
    name: "NYT Black Pepper Beef & Cabbage w/ Brown Rice",
    portion: "1 serving + rice",
    calories: 580, fiber: 6, saturated_fat: 7, sodium: 550,
    protein: 28, added_sugar: 2, vitamin_d: 5, emoji: "🥩"
  },
  "butter chicken": {
    name: "ATK Butter Chicken",
    portion: "1 serving (1/4)",
    calories: 450, fiber: 2, saturated_fat: 16, sodium: 850,
    protein: 38, added_sugar: 1, vitamin_d: 10, emoji: "🍗"
  },
  "rice": {
    name: "Basmati White Rice",
    portion: "1 cup cooked",
    calories: 210, fiber: 0.6, saturated_fat: 0, sodium: 2,
    protein: 4.3, added_sugar: 0, vitamin_d: 0, emoji: "🍚"
  },
  "apple": {
    name: "Apple",
    portion: "1 medium",
    calories: 95, fiber: 4.4, saturated_fat: 0, sodium: 2,
    protein: 0.5, added_sugar: 0, vitamin_d: 0, emoji: "🍎"
  },
  "grapes": {
    name: "Grapes",
    portion: "~1 cup",
    calories: 104, fiber: 1.4, saturated_fat: 0, sodium: 3,
    protein: 1.1, added_sugar: 0, vitamin_d: 0, emoji: "🍇"
  },
  "justins": {
    name: "Justin's Dark Choc PB Minis",
    portion: "3 pieces",
    calories: 225, fiber: 1.5, saturated_fat: 7.5, sodium: 128,
    protein: 3, added_sugar: 13.5, vitamin_d: 0, emoji: "🍬"
  },
  "carrots": {
    name: "Roasted Carrots",
    portion: "~1 cup",
    calories: 55, fiber: 3.6, saturated_fat: 0.3, sodium: 90,
    protein: 1, added_sugar: 0, vitamin_d: 0, emoji: "🥕"
  },
  "brussels": {
    name: "Roasted Brussels Sprouts",
    portion: "~1 cup",
    calories: 65, fiber: 4, saturated_fat: 0.3, sodium: 25,
    protein: 3.4, added_sugar: 0, vitamin_d: 0, emoji: "🥦"
  },
  "broccoli": {
    name: "Roasted Broccoli",
    portion: "~1 cup",
    calories: 55, fiber: 5, saturated_fat: 0.3, sodium: 30,
    protein: 3.7, added_sugar: 0, vitamin_d: 0, emoji: "🥦"
  },
  "fish tacos": {
    name: "NYT Fish Tacos (Tilapia)",
    portion: "1 serving (~3 tacos)",
    calories: 350, fiber: 5, saturated_fat: 2.5, sodium: 480,
    protein: 28, added_sugar: 0, vitamin_d: 30, emoji: "🌮"
  },
  "squash gratin": {
    name: "ATK Chicken Thighs w/ Spaghetti Squash Gratin",
    portion: "1 serving (1/4)",
    calories: 500, fiber: 2, saturated_fat: 12, sodium: 500,
    protein: 36, added_sugar: 0, vitamin_d: 13, emoji: "🍗"
  }
};
```

## Nutrient Targets & Display

```javascript
const NUTRIENT_TARGETS = {
  calories:     { goal: 1680, unit: "kcal", direction: "max", color: "#a3e635", label: "Calories" },
  fiber:        { goal: 38,   unit: "g",    direction: "min", color: "#22d3ee", label: "Fiber" },
  saturated_fat:{ goal: 16,   unit: "g",    direction: "max", color: "#f97316", label: "Sat Fat" },
  sodium:       { goal: 1800, unit: "mg",   direction: "max", color: "#a78bfa", label: "Sodium" },
  protein:      { goal: 140,  unit: "g",    direction: "min", color: "#34d399", label: "Protein" },
  added_sugar:  { goal: 36,   unit: "g",    direction: "max", color: "#fb7185", label: "Added Sugar" },
  vitamin_d:    { goal: 600,  unit: "IU",   direction: "min", color: "#fbbf24", label: "Vit D3" }
};
```

For "min" direction nutrients (fiber, protein, vitamin D): bar turns green when goal is met.
For "max" direction nutrients (sat fat, sodium, added sugar): bar turns red when exceeded.
Calorie ring: green when under, red when over.

## Claude API Integration

Used ONLY for non-preset foods. When the user types something that doesn't match a preset key, or attaches a photo, call the Claude API.

**Model:** claude-sonnet-4-20250514
**Max tokens:** 1000

**System prompt:**
```
You are a concise nutrition estimator. Respond ONLY with valid JSON, no markdown fences.
Format: { "items": [{ "name": "Food name", "calories": 350, "portion": "1 cup", "fiber_g": 5, "saturated_fat_g": 2, "sodium_mg": 400, "protein_g": 15, "added_sugar_g": 0, "vitamin_d_iu": 0 }], "total_calories": 350, "notes": "brief note if needed" }
Be realistic with portions. Estimate all nutrient fields as accurately as possible.
- fiber_g: total dietary fiber in grams
- saturated_fat_g: saturated fat only (not total fat) in grams
- sodium_mg: sodium in milligrams
- protein_g: protein in grams
- added_sugar_g: ADDED sugars only (not naturally occurring sugars from fruit/dairy) in grams
- vitamin_d_iu: vitamin D in International Units. Key sources: fatty fish (~450 IU/3oz), fortified milk (~120 IU/cup), eggs (~44 IU each). Most foods have 0.
If you see a photo, estimate based on visual size. If uncertain, give your best estimate and note it.
```

**For text input:**
```json
{ "role": "user", "content": "Estimate the full nutrition for this food: \"pad kee mao with tofu, restaurant serving\"" }
```

**For photo input:**
```json
{ "role": "user", "content": [
  { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "..." } },
  { "type": "text", "text": "Identify the food in this image and estimate the full nutrition." }
] }
```

**For photo + text:**
```json
{ "role": "user", "content": [
  { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "..." } },
  { "type": "text", "text": "Estimate the full nutrition for this food: \"salmon with roasted carrots and spinach\". Use the image for portion/food identification." }
] }
```

## Core User Flows

### Flow 1: Quick-add preset
1. User taps a chip or types a shortcut (e.g., "smoothie")
2. App looks up DEFAULT_PRESETS[key] or custom_presets table
3. Entry created instantly with all nutrient data, saved to Supabase
4. Dashboard updates immediately
5. **No Claude API call**

### Flow 2: Claude estimation (text)
1. User types free-text description (e.g., "2 eggs scrambled with toast")
2. Input doesn't match any preset key
3. App shows loading state, calls Claude API
4. Response parsed, entry/entries created and saved to Supabase
5. Each new entry shows "💾 Save as shortcut" button
6. Dashboard updates

### Flow 3: Claude estimation (photo)
1. User taps camera icon, takes photo or selects from gallery
2. Photo preview appears in input area
3. User optionally adds text description
4. App calls Claude API with image + text
5. Same as Flow 2 from step 4

### Flow 4: Save as preset
1. User taps "💾 Save as shortcut" on a Claude-estimated entry
2. Prompt asks for a shortcut name (suggests one based on food name)
3. Preset saved to Supabase custom_presets table
4. Chip appears in quick-add area immediately
5. Future uses of that shortcut are instant (no API call)

### Flow 5: Browse history
1. User taps left/right arrows to navigate dates
2. App queries Supabase for that date's entries
3. Dashboard shows that day's totals
4. Past days are read-only (no input area, no delete buttons)
5. "Today" button jumps back to current date

### Flow 6: View trends
1. User taps "Trends" tab
2. App queries Supabase for last 14 days of entries
3. Chart.js renders bar charts for calories, fiber, sat fat, protein
4. Goal line shown on each chart for reference

### Flow 7: Export CSV
1. User taps "Export CSV" button
2. App queries all food_entries from Supabase
3. Generates CSV with all columns
4. Triggers browser download

## Design Direction

**Aesthetic:** Dark, utilitarian, data-forward. Think fitness tracker meets terminal.
**Background:** Near-black (#0a0a0a) with subtle gradient
**Accent:** Lime green (#a3e635) for positive metrics
**Alert:** Red (#ef4444) for exceeded limits
**Typography:** DM Sans for body, JetBrains Mono for numbers/data
  - Load from Google Fonts CDN
**Layout:** Single column, max-width 480px, mobile-first
**Key UI elements:**
  - Calorie ring (SVG donut chart) — center of dashboard
  - Horizontal nutrient bars with color coding
  - Quick-add chips below input (tappable, wrap on multiple rows)
  - Entry list with inline nutrient tags (colored chips per entry)
  - Camera button in input row
  - Date navigation bar with arrows and "Today" button

## Configuration

The app needs these values configured (stored in `js/config.js`):

```javascript
const CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY",
  // Claude API key — in production, user enters this in settings
  // For development, can be hardcoded
  CLAUDE_API_KEY: ""
};
```

Users should be prompted to enter their Supabase credentials and Claude API key on first launch, stored in localStorage.

## Build Sessions for Claude Code

### Session 1: Project scaffold + Supabase connection
- Create file structure
- Set up config.js with Supabase credentials
- Implement db.js with CRUD operations
- Create presets.js with all default presets
- Test: can write and read a food entry from Supabase

### Session 2: Core UI + quick-add
- Build index.html shell with all sections
- Implement style.css (dark theme, mobile responsive)
- Build ui.js rendering functions (dashboard, entries, chips)
- Wire up quick-add flow (preset chips → instant log)
- Test: can tap "smoothie" chip and see it logged with nutrient bars updating

### Session 3: Claude integration + save as preset
- Implement claude.js (text + photo estimation)
- Add camera button with photo preview
- Wire up Claude estimation flow for non-preset inputs
- Implement "Save as shortcut" button → Supabase custom_presets
- Test: can type "pad kee mao with tofu", get estimate, save as preset

### Session 4: Date navigation + history
- Implement date navigation (arrows, today button)
- Query Supabase for historical entries
- Read-only view for past days
- Test: can browse back through days and see previous entries

### Session 5: Trends + export
- Implement charts.js with Chart.js
- Trends tab with 14-day bar charts (calories, fiber, sat fat, protein)
- Goal lines on charts
- CSV export function
- Test: can see trend charts and download CSV

### Session 6: PWA + polish
- Create manifest.json and service worker
- Generate app icons
- Add offline fallback
- Settings page for API keys and target adjustments
- Test: can install to phone home screen, works offline for presets

### Session 7: Garmin integration (Phase 1 — done)
- Enhanced burn_entries table with: activity_type, duration_mins, steps, source
- Claude burn estimation now returns structured exercise data
- UI shows duration, step count, and source per exercise entry
- Step total displayed in exercise section header
- source field is "manual" for user entries, "garmin" for future auto-sync

### Session 7 Phase 2: Garmin daily integration (done)
- `garmin_daily` table stores daily Garmin summaries (steps, active_calories, resting HR, sleep, body battery)
- App reads garmin_daily on load and auto-creates a `source: "garmin"` burn entry
- **Baseline logic**: When Garmin is tracking (steps >= 6000), full `active_calories` counts as extra burn. When watch appears not worn (steps < 6000), subtracts 200 baseline cal to avoid double-counting.
- Garmin card in exercise section shows steps, active cal, extra burn, plus optional HR/sleep/body battery
- Manual Garmin data entry form in Settings (for use until auto-sync bridge exists)
- Steps trend chart with 6k baseline line in Trends tab
- Constants: `GARMIN_BASELINE_STEPS = 6000`, `GARMIN_BASELINE_ACTIVE_CAL = 200` in config.js

**SQL to run in Supabase** (required before using this feature):
```sql
CREATE TABLE garmin_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT UNIQUE NOT NULL,
  total_steps INTEGER DEFAULT 0,
  active_calories REAL DEFAULT 0,
  resting_hr INTEGER,
  stress_avg INTEGER,
  sleep_hours REAL,
  body_battery_high INTEGER,
  body_battery_low INTEGER,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_garmin_daily_date ON garmin_daily(date);

ALTER TABLE garmin_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on garmin_daily" ON garmin_daily FOR ALL USING (true) WITH CHECK (true);
```

### Session 7 Phase 2b: Garmin auto-sync via GitHub Action (done)
- `scripts/garmin_sync.py` — Python script using `garminconnect` + `supabase-py`
- `.github/workflows/garmin-sync.yml` — Runs every 4 hours + manual dispatch, syncs last 3 days
- Fetches: steps, active calories, resting HR, stress avg, sleep (hours + score + stages), HRV, body battery
- Upserts to `garmin_daily` table in Supabase
- **GitHub Secrets required**: `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_KEY`
- Garmin card shows: steps, active/extra cal, sleep stages bar, sleep score, HRV, resting HR, stress (color-coded), body battery
- Sleep + HRV trend charts in Trends tab
- Daily review prompt includes Garmin health data (sleep quality, HRV, stress, body battery) alongside nutrition

**Additional SQL to add health columns** (run after initial garmin_daily table exists):
```sql
ALTER TABLE garmin_daily
  ADD COLUMN IF NOT EXISTS sleep_score INTEGER,
  ADD COLUMN IF NOT EXISTS deep_sleep_mins INTEGER,
  ADD COLUMN IF NOT EXISTS light_sleep_mins INTEGER,
  ADD COLUMN IF NOT EXISTS rem_sleep_mins INTEGER,
  ADD COLUMN IF NOT EXISTS awake_mins INTEGER,
  ADD COLUMN IF NOT EXISTS avg_hrv REAL;
```

### Session 8: Weekly Tripwire System (done)
- **Standard drinks tracking**: `standard_drinks` column added to `food_entries` and `custom_presets`. Claude food estimation prompt includes standard drink calculation (formula: `volume_oz × ABV / 0.6`). UI shows amber drink chip on entries and daily total.
- **Thursday Planning Prompt** (6 PM Central): Email with Mon-Thu exercise count and drink total, plus weekend pre-commitment nudge
- **Sunday Weekly Review** (8 PM Central): Color-coded scorecard email with exercise (3+/2/0-1), alcohol (≤7/8-14/15+), sleep (7+/6-7/<6), logging completeness (7/7/5-6/≤4), and missing data flags
- **Cascade Warning**: `weekly_scorecards` table stores results; 2 consecutive weeks with 2+ reds triggers warning, 3+ triggers escalation
- **Delivery**: GitHub Actions cron → Python script queries Supabase → email via Resend API with .ics calendar attachment
- **Files**: `scripts/weekly_tripwire.py`, `.github/workflows/weekly-tripwire.yml`
- **GitHub Secrets required**: `RESEND_API_KEY` (in addition to existing `SUPABASE_URL`, `SUPABASE_KEY`)
- **Exercise day definition**: Any day with a `source='manual'` burn entry (Garmin passive activity doesn't count)

**SQL to run in Supabase** (required before using this feature):
```sql
ALTER TABLE food_entries ADD COLUMN standard_drinks REAL DEFAULT 0;
ALTER TABLE custom_presets ADD COLUMN standard_drinks REAL DEFAULT 0;

CREATE TABLE weekly_scorecards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  exercise_days INTEGER DEFAULT 0,
  total_drinks REAL DEFAULT 0,
  avg_sleep REAL,
  days_logged INTEGER DEFAULT 0,
  exercise_rating TEXT,
  alcohol_rating TEXT,
  sleep_rating TEXT,
  logging_rating TEXT,
  missing_days TEXT,
  red_count INTEGER DEFAULT 0,
  cascade_count INTEGER DEFAULT 0,
  report_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_start, report_type)
);
ALTER TABLE weekly_scorecards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on weekly_scorecards" ON weekly_scorecards FOR ALL USING (true) WITH CHECK (true);
```

### Session 7 Phase 3: Garmin Calendar feed (future)
- User publishes their Garmin Connect training calendar (ICS feed)
- Subscribe to it in Google Calendar
- App could read planned workouts to show upcoming exercise on the dashboard
- Consider Google Calendar API or direct ICS parsing
- This was partially implemented in a previous Google Apps Script project

## Important Notes

- **No framework.** Vanilla JS only. Keep it simple.
- **Mobile-first.** Design for phone screen, then make sure it works on desktop too.
- **Presets are the fast path.** The Claude API should only be called when truly needed. Every preset lookup should be instant.
- **Column naming:** Use snake_case in the database (saturated_fat, added_sugar, vitamin_d) consistently. The old React tracker used camelCase — don't carry that over.
- **Camera on mobile:** Use `<input type="file" accept="image/*" capture="environment">` for the camera button. This opens the native camera on mobile.
- **No authentication for v1.** This is a single-user app. The Supabase anon key with permissive RLS is fine for now.
- **Calorie target context:** The 1680 kcal/day target is temporary (through April 8, 2026) to recover from a weekend surplus. Normal maintenance target is 1900 kcal/day. The targets table in Supabase allows easy adjustment.
