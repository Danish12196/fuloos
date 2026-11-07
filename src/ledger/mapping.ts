/* Maps the model's 12 canonical categories onto the user's own categories, however many they have. Phase A keeps
   the mapping in this browser only (localStorage); nothing about it is sent to the server. */
import type { Category } from "../domain.ts";
import { CANONICAL, type CanonicalCategory } from "./categoriser.ts";

export type CategoryMap = Partial<Record<CanonicalCategory, string | null>>;

const HINTS: Record<CanonicalCategory, string[]> = {
  Food_Dining: [
    "food",
    "dining",
    "restaurant",
    "eating out",
    "eat out",
    "takeaway",
    "delivery",
    "cafe",
    "coffee",
    "meal",
  ],
  Groceries: ["grocer", "supermarket", "household", "baqala"],
  Transport_Auto: [
    "transport",
    "car",
    "fuel",
    "petrol",
    "taxi",
    "salik",
    "parking",
    "auto",
    "commute",
    "travel local",
  ],
  Shopping_Retail: [
    "shopping",
    "retail",
    "clothes",
    "clothing",
    "electronics",
    "amazon",
    "noon",
    "gifts",
  ],
  Utilities_Telecom: [
    "utilit",
    "bills",
    "dewa",
    "electric",
    "water",
    "internet",
    "phone",
    "mobile",
    "telecom",
  ],
  Health_Wellness: [
    "health",
    "medical",
    "pharmacy",
    "doctor",
    "gym",
    "fitness",
    "wellness",
    "beauty",
    "personal care",
  ],
  Travel: ["travel", "holiday", "vacation", "flight", "hotel", "trip"],
  Entertainment: [
    "entertainment",
    "fun",
    "leisure",
    "movies",
    "cinema",
    "games",
    "hobbies",
    "going out",
  ],
  Government_Fees: ["government", "fees", "visa", "fines", "admin", "official"],
  Housing_Education: [
    "rent",
    "housing",
    "home",
    "education",
    "school",
    "tuition",
    "university",
    "cleaning",
    "maid",
  ],
  Digital_Subscriptions: [
    "subscription",
    "streaming",
    "software",
    "digital",
    "apps",
  ],
  Others: ["other", "misc", "general", "uncategor"],
};

/** Best guess from category names; each canonical category gets the user category whose name matches it best. */
export function guessMap(categories: Category[]): CategoryMap {
  const map: CategoryMap = {};
  for (const canon of CANONICAL) {
    let best: { id: string; score: number } | null = null;
    for (const c of categories) {
      const name = `${c.name} ${c.description}`.toLowerCase();
      const head = c.name.toLowerCase();
      let score = 0;
      HINTS[canon].forEach((h, i) => {
        // Hints match at the start of a word ("car" matches "Car loan", not "Scarf").
        const re = new RegExp(`(^|[^a-z])${h}`);
        if (re.test(head)) score = Math.max(score, 10 - i * 0.1);
        else if (re.test(name)) score = Math.max(score, 5 - i * 0.1);
      });
      if (score > 0 && (!best || score > best.score))
        best = { id: c.id, score };
    }
    map[canon] = best?.id ?? null;
  }
  return map;
}

const key = (owner: string) => `fuloos.ledger.categoryMap.${owner}`;

/** Saved mapping merged over a fresh guess; ids of deleted categories are dropped. */
export function loadMap(
  owner: string,
  categories: Category[],
): { map: CategoryMap; saved: boolean } {
  const guess = guessMap(categories);
  const ids = new Set(categories.map((c) => c.id));
  try {
    const raw = localStorage.getItem(key(owner));
    if (!raw) return { map: guess, saved: false };
    const stored = JSON.parse(raw) as CategoryMap;
    const map: CategoryMap = { ...guess };
    for (const canon of CANONICAL) {
      const v = stored[canon];
      if (v === null) map[canon] = null;
      else if (typeof v === "string" && ids.has(v)) map[canon] = v;
    }
    return { map, saved: true };
  } catch {
    return { map: guess, saved: false };
  }
}

export function saveMap(owner: string, map: CategoryMap) {
  try {
    localStorage.setItem(key(owner), JSON.stringify(map));
  } catch {
    // Storage blocked (private mode): the mapping still applies for this import.
  }
}
