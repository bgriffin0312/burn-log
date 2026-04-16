// Supabase database operations
let db = null;

function initSupabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    console.warn("Supabase credentials not configured");
    return false;
  }
  db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return true;
}

// ── Food Entries ──

async function addFoodEntry(entry) {
  const { data, error } = await db
    .from("food_entries")
    .insert([entry])
    .select();
  if (error) throw error;
  return data[0];
}

async function getEntriesForDate(date) {
  const { data, error } = await db
    .from("food_entries")
    .select("*")
    .eq("date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

async function deleteEntry(id) {
  const { error } = await db
    .from("food_entries")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

async function getAllEntries() {
  const { data, error } = await db
    .from("food_entries")
    .select("*")
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

async function getEntriesForDateRange(startDate, endDate) {
  const { data, error } = await db
    .from("food_entries")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// ── Custom Presets ──

async function getCustomPresets() {
  const { data, error } = await db
    .from("custom_presets")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

async function saveCustomPreset(preset) {
  const { data, error } = await db
    .from("custom_presets")
    .upsert([preset], { onConflict: "key" })
    .select();
  if (error) throw error;
  return data[0];
}

async function deleteCustomPreset(id) {
  const { error } = await db
    .from("custom_presets")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ── Daily Targets ──

async function getDailyTargets() {
  const { data, error } = await db
    .from("daily_targets")
    .select("*");
  if (error) throw error;
  return data;
}

async function updateDailyTarget(metric, goal) {
  const { data, error } = await db
    .from("daily_targets")
    .update({ goal, updated_at: new Date().toISOString() })
    .eq("metric", metric)
    .select();
  if (error) throw error;
  return data[0];
}

// ── Burn Entries ──

async function addBurnEntry(entry) {
  const { data, error } = await db
    .from("burn_entries")
    .insert([entry])
    .select();
  if (error) throw error;
  return data[0];
}

async function getBurnsForDate(date) {
  const { data, error } = await db
    .from("burn_entries")
    .select("*")
    .eq("date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

async function getBurnsForDateRange(startDate, endDate) {
  const { data, error } = await db
    .from("burn_entries")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });
  if (error) throw error;
  return data;
}

async function deleteBurnEntry(id) {
  const { error } = await db
    .from("burn_entries")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ── Garmin Daily ──

async function getGarminDaily(date) {
  const { data, error } = await db
    .from("garmin_daily")
    .select("*")
    .eq("date", date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getGarminDailyRange(startDate, endDate) {
  const { data, error } = await db
    .from("garmin_daily")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });
  if (error) throw error;
  return data;
}

async function upsertGarminDaily(entry) {
  const { data, error } = await db
    .from("garmin_daily")
    .upsert([entry], { onConflict: "date" })
    .select();
  if (error) throw error;
  return data[0];
}

// ── Helpers ──

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTimeString() {
  return new Date().toTimeString().slice(0, 5);
}

function buildEntryFromPreset(key, preset) {
  return {
    date: todayString(),
    time: nowTimeString(),
    name: preset.name,
    portion: preset.portion,
    calories: preset.calories,
    fiber: preset.fiber,
    saturated_fat: preset.saturated_fat,
    sodium: preset.sodium,
    protein: preset.protein,
    added_sugar: preset.added_sugar,
    vitamin_d: preset.vitamin_d,
    standard_drinks: preset.standard_drinks || 0,
    preset_key: key,
    from_claude: false
  };
}

function buildEntryFromClaude(item) {
  return {
    date: todayString(),
    time: nowTimeString(),
    name: item.name,
    portion: item.portion || "",
    calories: item.calories || 0,
    fiber: item.fiber_g || 0,
    saturated_fat: item.saturated_fat_g || 0,
    sodium: item.sodium_mg || 0,
    protein: item.protein_g || 0,
    added_sugar: item.added_sugar_g || 0,
    vitamin_d: item.vitamin_d_iu || 0,
    standard_drinks: item.standard_drinks || 0,
    from_claude: true
  };
}
