# Burn Log — Personal Nutrition Tracker

A Progressive Web App for tracking calories and key nutrients, with AI-powered food estimation and preset shortcuts for regular meals.

## Quick Start

### 1. Create a Supabase project
- Go to [supabase.com](https://supabase.com) and create a free account
- Click "New Project", name it "burn-log"
- Save your **Project URL** and **anon public key** (found in Settings → API)

### 2. Create the database tables
- In your Supabase dashboard, go to **SQL Editor**
- Paste the SQL from the "Supabase Schema" section of `CLAUDE.md`
- Click "Run"

### 3. Clone and configure
```bash
git clone https://github.com/YOUR_USERNAME/burn-log.git
cd burn-log
```

Edit `js/config.js` and add your Supabase URL and anon key.

### 4. Run locally
Just open `index.html` in your browser. No build step needed.

Or use a local server:
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### 5. Deploy to GitHub Pages
```bash
git add .
git commit -m "Initial commit"
git push origin main
```
Then in your repo settings, enable GitHub Pages from the main branch.

### 6. Install on your phone
Open your GitHub Pages URL on your phone's browser. Tap "Add to Home Screen" (iOS) or the install prompt (Android). The app now works like a native app.

## Getting a Claude API Key

To use the AI food estimation feature (photos and free-text descriptions), you need a Claude API key:

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Go to API Keys and create a new key
4. Enter the key in the Burn Log settings (gear icon)

Without an API key, you can still use all the preset shortcuts — they don't require AI.

## Usage

- **Preset shortcuts:** Tap a chip or type the shortcut name (e.g., "smoothie", "salmon", "broccoli")
- **AI estimation:** Type any food description (e.g., "pad kee mao with tofu") or take a photo
- **Save as preset:** After Claude estimates a food, tap "💾 Save as shortcut" to add it to your presets
- **Browse history:** Use the arrows to navigate between days
- **Trends:** Tap the Trends tab to see 14-day charts
- **Export:** Tap "Export CSV" to download all your data

## Tracked Nutrients

| Nutrient | Daily Target | Direction |
|---|---|---|
| Calories | 1,680 kcal | Max (deficit target through Apr 8) |
| Fiber | 38g | Min |
| Saturated Fat | 16g | Max |
| Sodium | 1,800mg | Max |
| Protein | 140g | Min |
| Added Sugar | 36g | Max |
| Vitamin D | 600 IU | Min |
