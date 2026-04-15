// Claude API integration for food estimation

const CLAUDE_SYSTEM_PROMPT = `You are a concise nutrition estimator. Respond ONLY with valid JSON, no markdown fences.
Format: { "items": [{ "name": "Food name", "calories": 350, "portion": "1 cup", "fiber_g": 5, "saturated_fat_g": 2, "sodium_mg": 400, "protein_g": 15, "added_sugar_g": 0, "vitamin_d_iu": 0 }], "total_calories": 350, "notes": "brief note if needed" }
Be realistic with portions. When the user specifies a quantity (e.g. "4 pretzel crisps", "3 chips"), calculate nutrition for EXACTLY that amount — do NOT round up to a standard serving size. Scale all nutrients proportionally from the per-serving data. Estimate all nutrient fields as accurately as possible.
- fiber_g: total dietary fiber in grams
- saturated_fat_g: saturated fat only (not total fat) in grams
- sodium_mg: sodium in milligrams
- protein_g: protein in grams
- added_sugar_g: ADDED sugars only (not naturally occurring sugars from fruit/dairy) in grams
- vitamin_d_iu: vitamin D in International Units. Key sources: fatty fish (~450 IU/3oz), fortified milk (~120 IU/cup), eggs (~44 IU each). Most foods have 0.
If you see a photo, estimate based on visual size. If uncertain, give your best estimate and note it.`;

async function estimateWithClaude(text, photoFile) {
  if (!CONFIG.CLAUDE_API_KEY) {
    throw new Error("Claude API key not configured. Add it in settings.");
  }

  const content = await buildMessageContent(text, photoFile);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 1000,
      system: CLAUDE_SYSTEM_PROMPT,
      messages: [{ role: "user", content }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const rawText = data.content[0].text;

  try {
    return JSON.parse(rawText);
  } catch (e) {
    // Try to extract JSON from response if it has extra text
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse Claude response as JSON");
  }
}

async function buildMessageContent(text, photoFile) {
  // Photo + optional text
  if (photoFile) {
    const base64 = await fileToBase64(photoFile);
    const mediaType = photoFile.type || "image/jpeg";
    const parts = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }
    ];
    if (text) {
      parts.push({ type: "text", text: `Estimate the full nutrition for this food: "${text}". Use the image for portion/food identification.` });
    } else {
      parts.push({ type: "text", text: "Identify the food in this image and estimate the full nutrition." });
    }
    return parts;
  }

  // Text only
  return `Estimate the full nutrition for this food: "${text}"`;
}

const CLAUDE_BURN_PROMPT = `You are a concise exercise calorie estimator for a 49-year-old man, 5'10", 215 lbs. Respond ONLY with valid JSON, no markdown fences.
Format: { "name": "Activity name", "activity_type": "running", "duration_mins": 30, "calories": 390, "steps": 3500, "notes": "brief note if needed" }
- activity_type: one of "running", "walking", "cycling", "strength", "cardio", "sports", "other"
- duration_mins: estimated duration in minutes (infer from context if not stated)
- calories: NET extra calories burned (above resting metabolic rate — do not include BMR)
- steps: estimated step count for the activity (0 for non-step activities like cycling or strength)
Be realistic. Running burns ~130 cal/mile at this weight. Walking burns ~80 cal/mile. Strength training burns ~200 cal/30 min.
If duration or intensity is unclear, assume moderate effort and note your assumption.`;

async function estimateBurnWithClaude(text) {
  if (!CONFIG.CLAUDE_API_KEY) {
    throw new Error("Claude API key not configured.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 500,
      system: CLAUDE_BURN_PROMPT,
      messages: [{ role: "user", content: `Estimate net calories burned for: "${text}"` }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const rawText = data.content[0].text;

  try {
    return JSON.parse(rawText);
  } catch (e) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse Claude burn response as JSON");
  }
}

const CLAUDE_FEEDBACK_PROMPT = `You are a supportive but honest health coach for a 49-year-old man (5'10", 215 lbs) working on weight loss, managing high LDL cholesterol (148), borderline A1C (5.6), and low vitamin D (19 ng/mL). His calorie target is set for ~1 lb/week loss assuming a sedentary baseline of ~6000 steps/day.

You'll receive yesterday's complete nutrition data, Garmin health data (sleep, HRV, stress, body battery, steps), a 7-day rolling average, and today's partial data. Your job is to REVIEW YESTERDAY holistically and give a brief heads-up for today.

Structure your feedback in two parts:
1. Yesterday review (2-3 sentences): How did yesterday go? Weave together nutrition AND health data — sleep quality, recovery, activity level, and how they connect to nutrition choices.
2. Today note (1 sentence): A brief encouragement or heads-up for today based on trends, recovery state, and what's logged so far.

Tone: encouraging but real — like a good friend who knows both nutrition and exercise science.

Nutrition guidelines:
- Any day in a calorie deficit is progress, even if under the 1 lb/week pace. Acknowledge it.
- If the 7-day rolling average is NET POSITIVE (consuming more than the target consistently), give a gentle nudge. Don't be harsh, but be direct.
- Call out good patterns: high fiber days, good protein intake, vitamin D wins (salmon, supplements), low added sugar.
- Flag problematic patterns: high sodium days, saturated fat spikes, low fiber, low protein.
- If yesterday has zero entries logged, encourage him to reconstruct it from memory. Missing data makes the trends unreliable.

Health/recovery guidelines (use Garmin data when present):
- Sleep: < 6h or sleep score < 60 is poor. Flag it — poor sleep increases cravings and impairs recovery. Good deep sleep (> 60 min) is worth celebrating.
- HRV: Higher is better. A drop from his usual baseline suggests accumulated stress or poor recovery. If HRV is low + stress is high, suggest prioritizing recovery.
- Stress: Average < 30 is great, 30-50 is normal, > 50 is elevated, > 70 is high. Connect to nutrition: high stress days may warrant being gentler on calorie targets.
- Body battery: Low end < 20 means he started the day depleted. High end > 80 means good recovery.
- Steps/activity: Celebrate active days. If very active + poor sleep, note the recovery imbalance.

Keep it concise. No bullet lists. Just talk to him.

Respond ONLY with valid JSON, no markdown fences.
Format: { "feedback": "Your message here", "highlights": ["one", "two"], "concerns": ["one"] }
- highlights: 1-3 brief positive things from yesterday (shown as green chips)
- concerns: 0-2 brief things to watch (shown as orange chips)
- Either array can be empty.`;

async function getDailyFeedback(yesterdayData, todayData, weekData, missingDays, yesterdayGarmin, todayGarmin) {
  if (!CONFIG.CLAUDE_API_KEY) {
    throw new Error("Claude API key not configured.");
  }

  const payload = {
    yesterday: yesterdayData,
    today_so_far: todayData,
    rolling_7_day: weekData,
    missing_days: missingDays
  };
  if (yesterdayGarmin) payload.yesterday_garmin = yesterdayGarmin;
  if (todayGarmin) payload.today_garmin = todayGarmin;
  const userMessage = JSON.stringify(payload);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 500,
      system: CLAUDE_FEEDBACK_PROMPT,
      messages: [{ role: "user", content: userMessage }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const rawText = data.content[0].text;

  try {
    return JSON.parse(rawText);
  } catch (e) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse feedback response");
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Strip the data URL prefix (data:image/jpeg;base64,)
      const result = reader.result.split(",")[1];
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
