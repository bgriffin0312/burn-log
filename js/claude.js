// Claude API integration for food estimation

const CLAUDE_SYSTEM_PROMPT = `You are a concise nutrition estimator. Respond ONLY with valid JSON, no markdown fences.
Format: { "items": [{ "name": "Food name", "calories": 350, "portion": "1 cup", "fiber_g": 5, "saturated_fat_g": 2, "sodium_mg": 400, "protein_g": 15, "added_sugar_g": 0, "vitamin_d_iu": 0 }], "total_calories": 350, "notes": "brief note if needed" }
Be realistic with portions. Estimate all nutrient fields as accurately as possible.
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
