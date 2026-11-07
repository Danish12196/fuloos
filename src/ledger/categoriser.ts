/* Confidence cascade from expense_categoriser_train_test.ipynb: your own corrections -> brand/keyword rules -> the
   calibrated model. The first tier whose top score clears the review threshold decides; otherwise the best guess is
   returned with needs_review = true. Works without a model (rules only). */
import { LEDGER_RULES as T } from "./rules.generated.ts";
import { predictProba, type LoadedModel } from "./model.ts";

export const CANONICAL = Object.keys(T.CATEGORIES) as CanonicalCategory[];
export type CanonicalCategory = keyof typeof T.CATEGORIES;
export const CANONICAL_LABEL: Record<CanonicalCategory, string> = {
  Food_Dining: "Food & dining",
  Groceries: "Groceries",
  Transport_Auto: "Transport & car",
  Shopping_Retail: "Shopping",
  Utilities_Telecom: "Utilities & telecom",
  Health_Wellness: "Health & wellness",
  Travel: "Travel",
  Entertainment: "Entertainment",
  Government_Fees: "Government fees",
  Housing_Education: "Housing & education",
  Digital_Subscriptions: "Digital subscriptions",
  Others: "Other",
};
export const DEFAULT_REVIEW_THRESHOLD = 0.6;

export function makeText(merchant: string | null): string {
  let t = String(merchant ?? "").toUpperCase();
  t = t.replace(/\+?\d[\d -]{4,}/g, " ");
  t = t.replace(/[^A-Z& ]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

const rx = (src: string, flags = "") => new RegExp(src, flags);
const KEYWORDS: [CanonicalCategory, RegExp][] = T.KEYWORDS.map(([c, s]) => [
  c as CanonicalCategory,
  rx(s, "i"),
]);
const CITY = rx(T.CITY, "gi");
const AMBIGUOUS = new Set<string>(T.AMBIGUOUS);
const BRAND = T.BRAND as Record<string, CanonicalCategory>;
const RULE_CONF = T.RULE_CONF as Record<string, number>;

/** Brand table, then category keywords (rules.py suggest(), without the private merchant overrides). */
export function ruleSuggestion(
  merchantClean: string,
  raw: string | null,
): {
  category: CanonicalCategory;
  source: "brand" | "keyword" | "rule";
  confidence: number;
} | null {
  if (merchantClean === "UNKNOWN MERCHANT")
    return { category: "Others", source: "rule", confidence: RULE_CONF.rule };
  if (Object.prototype.hasOwnProperty.call(BRAND, merchantClean))
    return {
      category: BRAND[merchantClean],
      source: "brand",
      confidence: AMBIGUOUS.has(merchantClean) ? 0.7 : RULE_CONF.brand,
    };
  const text = `${merchantClean} ${raw ?? ""}`.replace(CITY, " ");
  for (const [category, re] of KEYWORDS)
    if (re.test(text))
      return { category, source: "keyword", confidence: RULE_CONF.keyword };
  return null;
}

function spread(cat: number, conf: number, base: number[]): number[] {
  const other = base.slice();
  other[cat] = 0;
  const s = other.reduce((a, b) => a + b, 0);
  const out =
    s > 0
      ? other.map((v) => (v / s) * (1 - conf))
      : other.map(() => (1 - conf) / (base.length - 1));
  out[cat] = conf;
  return out;
}

export interface CategorySuggestion {
  category: CanonicalCategory | null;
  confidence: number;
  decidedBy: "your corrections" | "rules" | "model" | "none";
  needsReview: boolean;
  runnerUp: CanonicalCategory | null;
  scores: number[] | null;
}

/** lookup: exact cleaned-merchant text -> [category, confidence], built from the user's own corrections. */
export function categorise(
  model: LoadedModel | null,
  merchant: string | null,
  amountAed: number,
  lookup?: Map<string, [CanonicalCategory, number]>,
  threshold = model?.review_threshold ?? DEFAULT_REVIEW_THRESHOLD,
): CategorySuggestion {
  const text = makeText(merchant);
  const K = CANONICAL.length;
  const base = model
    ? predictProba(model, text, amountAed)
    : new Array<number>(K).fill(1 / K);
  const tiers: [CategorySuggestion["decidedBy"], number[]][] = [];
  const own = lookup?.get(text);
  if (own)
    tiers.push([
      "your corrections",
      spread(CANONICAL.indexOf(own[0]), own[1], base),
    ]);
  // Brand names arrive canonical ("Talabat"), so look them up before upper-casing.
  const rule = ruleSuggestion(
    merchant && Object.prototype.hasOwnProperty.call(BRAND, merchant)
      ? merchant
      : text,
    merchant,
  );
  if (rule)
    tiers.push([
      "rules",
      spread(CANONICAL.indexOf(rule.category), rule.confidence, base),
    ]);
  if (model) tiers.push(["model", base]);
  if (!tiers.length)
    return {
      category: null,
      confidence: 0,
      decidedBy: "none",
      needsReview: true,
      runnerUp: null,
      scores: null,
    };
  let chosen = tiers.find(([, p]) => Math.max(...p) >= threshold);
  const needsReview = !chosen;
  if (!chosen)
    chosen = tiers.reduce((a, t) =>
      Math.max(...t[1]) > Math.max(...a[1]) ? t : a,
    );
  const [decidedBy, p] = chosen;
  const idx = p.map((_, i) => i).sort((a, b) => p[b] - p[a]);
  return {
    category: CANONICAL[idx[0]],
    confidence: p[idx[0]],
    decidedBy,
    needsReview,
    runnerUp: CANONICAL[idx[1]] ?? null,
    scores: p,
  };
}
