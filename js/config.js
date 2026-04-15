// Burn Log Configuration
// Credentials are loaded from localStorage if available,
// falling back to the hardcoded values below.

const CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  CLAUDE_API_KEY: "",
  CLAUDE_MODEL: "claude-sonnet-4-20250514"
};

// Override with localStorage values if present
(function loadSavedConfig() {
  const saved = localStorage.getItem("burnlog_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.SUPABASE_URL) CONFIG.SUPABASE_URL = parsed.SUPABASE_URL;
      if (parsed.SUPABASE_ANON_KEY) CONFIG.SUPABASE_ANON_KEY = parsed.SUPABASE_ANON_KEY;
      if (parsed.CLAUDE_API_KEY) CONFIG.CLAUDE_API_KEY = parsed.CLAUDE_API_KEY;
    } catch (e) {
      console.warn("Failed to parse saved config:", e);
    }
  }
})();

function saveConfig(url, anonKey, claudeKey) {
  CONFIG.SUPABASE_URL = url || CONFIG.SUPABASE_URL;
  CONFIG.SUPABASE_ANON_KEY = anonKey || CONFIG.SUPABASE_ANON_KEY;
  CONFIG.CLAUDE_API_KEY = claudeKey || CONFIG.CLAUDE_API_KEY;
  localStorage.setItem("burnlog_config", JSON.stringify({
    SUPABASE_URL: CONFIG.SUPABASE_URL,
    SUPABASE_ANON_KEY: CONFIG.SUPABASE_ANON_KEY,
    CLAUDE_API_KEY: CONFIG.CLAUDE_API_KEY
  }));
}

// Garmin baseline: the calorie target already assumes ~6k steps/day of activity.
// Only count Garmin active calories ABOVE this baseline as "extra burn."
const GARMIN_BASELINE_STEPS = 6000;
const GARMIN_BASELINE_ACTIVE_CAL = 200;

const NUTRIENT_TARGETS = {
  calories:      { goal: 1680, unit: "kcal", direction: "max", color: "#a3e635", label: "Calories" },
  fiber:         { goal: 38,   unit: "g",    direction: "min", color: "#22d3ee", label: "Fiber" },
  saturated_fat: { goal: 16,   unit: "g",    direction: "max", color: "#f97316", label: "Sat Fat" },
  sodium:        { goal: 1800, unit: "mg",   direction: "max", color: "#a78bfa", label: "Sodium" },
  protein:       { goal: 140,  unit: "g",    direction: "min", color: "#34d399", label: "Protein" },
  added_sugar:   { goal: 36,   unit: "g",    direction: "max", color: "#fb7185", label: "Added Sugar" },
  vitamin_d:     { goal: 600,  unit: "IU",   direction: "min", color: "#fbbf24", label: "Vit D3" }
};
