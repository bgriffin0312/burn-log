// Default preset foods — available instantly without any API or DB call
const DEFAULT_PRESETS = {
  "smoothie": {
    name: "Smoothie (OJ/banana/blueberry/chia/yogurt)",
    portion: "full recipe",
    calories: 665, fiber: 21.2, saturated_fat: 7, sodium: 115,
    protein: 18.5, added_sugar: 0, vitamin_d: 190, emoji: "\u{1F964}"
  },
  "crackers": {
    name: "Good Thins Corn & Rice",
    portion: "8 crackers",
    calories: 25, fiber: 0.2, saturated_fat: 0, sodium: 38,
    protein: 0.4, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F35E}"
  },
  "pineapple": {
    name: "Fresh Pineapple",
    portion: "~1 cup chunks",
    calories: 82, fiber: 2.3, saturated_fat: 0, sodium: 2,
    protein: 0.9, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F34D}"
  },
  "stew": {
    name: "Pork & Cabbage Stew w/ Cheddar Dumplings",
    portion: "1 serving (1/6)",
    calories: 465, fiber: 4, saturated_fat: 12, sodium: 680,
    protein: 28, added_sugar: 0, vitamin_d: 15, emoji: "\u{1F372}"
  },
  "salmon": {
    name: "Roasted Salmon",
    portion: "~6oz fillet",
    calories: 350, fiber: 0, saturated_fat: 3, sodium: 80,
    protein: 38, added_sugar: 0, vitamin_d: 450, emoji: "\u{1F41F}"
  },
  "pepper beef": {
    name: "NYT Black Pepper Beef & Cabbage w/ Brown Rice",
    portion: "1 serving + rice",
    calories: 580, fiber: 6, saturated_fat: 7, sodium: 550,
    protein: 28, added_sugar: 2, vitamin_d: 5, emoji: "\u{1F969}"
  },
  "butter chicken": {
    name: "ATK Butter Chicken",
    portion: "1 serving (1/4)",
    calories: 450, fiber: 2, saturated_fat: 16, sodium: 850,
    protein: 38, added_sugar: 1, vitamin_d: 10, emoji: "\u{1F357}"
  },
  "rice": {
    name: "Basmati White Rice",
    portion: "1 cup cooked",
    calories: 210, fiber: 0.6, saturated_fat: 0, sodium: 2,
    protein: 4.3, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F35A}"
  },
  "apple": {
    name: "Apple",
    portion: "1 medium",
    calories: 95, fiber: 4.4, saturated_fat: 0, sodium: 2,
    protein: 0.5, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F34E}"
  },
  "grapes": {
    name: "Grapes",
    portion: "~1 cup",
    calories: 104, fiber: 1.4, saturated_fat: 0, sodium: 3,
    protein: 1.1, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F347}"
  },
  "justins": {
    name: "Justin's Dark Choc PB Minis",
    portion: "3 pieces",
    calories: 225, fiber: 1.5, saturated_fat: 7.5, sodium: 128,
    protein: 3, added_sugar: 13.5, vitamin_d: 0, emoji: "\u{1F36C}"
  },
  "carrots": {
    name: "Roasted Carrots",
    portion: "~1 cup",
    calories: 55, fiber: 3.6, saturated_fat: 0.3, sodium: 90,
    protein: 1, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F955}"
  },
  "brussels": {
    name: "Roasted Brussels Sprouts",
    portion: "~1 cup",
    calories: 65, fiber: 4, saturated_fat: 0.3, sodium: 25,
    protein: 3.4, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F966}"
  },
  "broccoli": {
    name: "Roasted Broccoli",
    portion: "~1 cup",
    calories: 55, fiber: 5, saturated_fat: 0.3, sodium: 30,
    protein: 3.7, added_sugar: 0, vitamin_d: 0, emoji: "\u{1F966}"
  },
  "fish tacos": {
    name: "NYT Fish Tacos (Tilapia)",
    portion: "1 serving (~3 tacos)",
    calories: 350, fiber: 5, saturated_fat: 2.5, sodium: 480,
    protein: 28, added_sugar: 0, vitamin_d: 30, emoji: "\u{1F32E}"
  },
  "squash gratin": {
    name: "ATK Chicken Thighs w/ Spaghetti Squash Gratin",
    portion: "1 serving (1/4)",
    calories: 500, fiber: 2, saturated_fat: 12, sodium: 500,
    protein: 36, added_sugar: 0, vitamin_d: 13, emoji: "\u{1F357}"
  }
};
