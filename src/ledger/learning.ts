/* Phase B: learning from each user's own categorisations.

   The correction log (fuloos_ml_examples) is the source of truth. The personal model is rebuilt from it in the
   browser every time it is needed, on top of whichever base model is loaded, so a new base model version never
   discards a user's training. Nothing here leaves the device except the log rows themselves, which hold the
   cleaned merchant text only (never the SMS). */
import {
  CANONICAL,
  DEFAULT_REVIEW_THRESHOLD,
  categorise,
  makeText,
  type CanonicalCategory,
} from "./categoriser.ts";
import { fnv1a, type LoadedModel } from "./model.ts";
import type { CategoryMap } from "./mapping.ts";

export const CONSENT_VERSION = "learn-v1";

export interface LearningSettings {
  id?: string;
  learn_consent: boolean;
  consent_version: string;
  consent_at: string;
  category_map: CategoryMap;
}
export const defaultLearningSettings = (): LearningSettings => ({
  learn_consent: false,
  consent_version: "",
  consent_at: "",
  category_map: {},
});

export type ExampleSource = "sms" | "csv" | "manual";
export interface LearningExample {
  id?: string;
  merchant_text: string;
  payee: string;
  amount: number;
  category_id: string | null;
  source: ExampleSource;
  model_version: string;
  suggested_category: string;
  accepted: boolean;
  created?: string;
}

/** Stored category_map: { "<canonical>": ["<category id>", ...] }. Fuloos uses the first existing id. */
export function mapFromStored(
  raw: unknown,
  categoryIds: Set<string>,
): CategoryMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const map: CategoryMap = {};
  for (const canon of CANONICAL) {
    const v = (raw as Record<string, unknown>)[canon];
    const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    const id = list.find(
      (x): x is string => typeof x === "string" && categoryIds.has(x),
    );
    if (id) map[canon] = id;
    else if (Array.isArray(v) && v.length === 0) map[canon] = null;
  }
  return map;
}
export function mapToStored(map: CategoryMap): Record<string, string[]> {
  return Object.fromEntries(
    CANONICAL.map((c) => [c, map[c] ? [map[c] as string] : []]),
  );
}

/** Text used as the learning key: the categoriser's cleaned merchant text (letters only, no digits). */
export function merchantKey(merchant: string | null): string {
  const text = makeText(merchant);
  return text === "UNKNOWN MERCHANT" ? "" : text.slice(0, 120);
}

export function makeExample(input: {
  merchant: string | null;
  payee: string;
  amount: number;
  category_id: string | null;
  suggested_category_id: string | null;
  source: ExampleSource;
  model_version: string;
}): LearningExample | null {
  const merchant_text = merchantKey(input.merchant);
  if (!merchant_text || !input.category_id) return null;
  return {
    merchant_text,
    payee: input.payee.trim().slice(0, 160),
    amount: Math.max(0, Math.round(input.amount)),
    category_id: input.category_id,
    source: input.source,
    model_version: input.model_version.slice(0, 32),
    suggested_category: (input.suggested_category_id ?? "").slice(0, 64),
    accepted: input.suggested_category_id === input.category_id,
  };
}

// ------------------------------------------------------------ personal classifier
const BUCKETS = 2048;
function personalFeatures(
  text: string,
  amountAed: number,
  base: number[],
): [number, number][] {
  const grams = new Map<number, number>();
  for (const word of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const w = ` ${word} `;
    for (let n = 3; n <= 4; n++)
      for (let i = 0; i + n <= w.length; i++) {
        const b = fnv1a("p\u0001" + w.slice(i, i + n)) % BUCKETS;
        grams.set(b, (grams.get(b) ?? 0) + 1);
      }
  }
  let norm = 0;
  for (const v of grams.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const feats: [number, number][] = [...grams].map(([b, v]) => [b, v / norm]);
  base.forEach((p, k) => feats.push([BUCKETS + k, p]));
  feats.push([
    BUCKETS + CANONICAL.length,
    Math.log1p(Math.max(0, amountAed)) / 8,
  ]);
  feats.push([BUCKETS + CANONICAL.length + 1, 1]);
  return feats;
}
const FEATURES = BUCKETS + CANONICAL.length + 2;

interface Classifier {
  classes: string[];
  weights: Float64Array[];
}
function softmax(z: number[]): number[] {
  const mx = Math.max(...z);
  const e = z.map((v) => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
function predictClassifier(c: Classifier, x: [number, number][]): number[] {
  const z = new Array<number>(c.weights.length);
  for (let k = 0; k < c.weights.length; k++) {
    const w = c.weights[k];
    let s = 0;
    for (let i = 0; i < x.length; i++) s += w[x[i][0]] * x[i][1];
    z[k] = s;
  }
  return softmax(z);
}
function train(
  rows: { x: [number, number][]; y: string }[],
  epochs = 12,
): Classifier {
  const classes = [...new Set(rows.map((r) => r.y))].sort();
  const index = new Map(classes.map((c, i) => [c, i]));
  const weights = classes.map(() => new Float64Array(FEATURES));
  const lr = 0.5,
    l2 = 1e-4;
  // Deterministic shuffle so results are reproducible.
  const order = rows.map((_, i) => i);
  let seed = 12345;
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const step = lr / (1 + epoch * 0.1);
    for (const r of order) {
      const { x, y } = rows[r];
      const p = predictClassifier({ classes, weights }, x);
      const target = index.get(y)!;
      for (let k = 0; k < classes.length; k++) {
        const g = p[k] - (k === target ? 1 : 0);
        const w = weights[k];
        for (let i = 0; i < x.length; i++) {
          const j = x[i][0];
          w[j] -= step * (g * x[i][1] + l2 * w[j]);
        }
      }
    }
  }
  return { classes, weights };
}

// ------------------------------------------------------------ personal model
export interface PersonalModel {
  lookup: Map<
    string,
    { category_id: string; share: number; count: number; payee: string }
  >;
  classifier: Classifier | null;
  stats: {
    examples: number;
    holdout: number;
    personalAccuracy: number | null;
    baselineAccuracy: number | null;
    usesClassifier: boolean;
  };
}

export interface UserSuggestion {
  category_id: string | null;
  canonical: CanonicalCategory | null;
  confidence: number;
  decidedBy: "your corrections" | "personal model" | "rules" | "model" | "none";
  needsReview: boolean;
  /** The payee this user last chose for the same merchant, if any. */
  payee: string | null;
}

const MIN_EXAMPLES = 20;
const MAX_EXAMPLES = 2000;

function baseScores(
  model: LoadedModel | null,
  text: string,
  amountAed: number,
): number[] {
  const s = categorise(model, text, amountAed);
  return s.scores ?? new Array<number>(CANONICAL.length).fill(0);
}

function baseline(
  model: LoadedModel | null,
  map: CategoryMap,
  text: string,
  amountAed: number,
): string | null {
  const s = categorise(model, text, amountAed);
  return s.category ? (map[s.category] ?? null) : null;
}

/**
 * Build the personal model from the log (oldest first). The classifier is only used when, trained on the older 80%,
 * it beats the plain mapping on the newest 20% of the user's own corrections.
 */
export function buildPersonalModel(
  examples: LearningExample[],
  model: LoadedModel | null,
  map: CategoryMap,
  categoryIds: Set<string>,
): PersonalModel {
  const usable = examples
    .filter(
      (e) => e.merchant_text && e.category_id && categoryIds.has(e.category_id),
    )
    .slice(-MAX_EXAMPLES);
  const groups = new Map<string, LearningExample[]>();
  for (const e of usable) {
    const list = groups.get(e.merchant_text) ?? [];
    list.push(e);
    groups.set(e.merchant_text, list);
  }
  const lookup: PersonalModel["lookup"] = new Map();
  for (const [text, list] of groups) {
    // Recent choices count more: the newest five decide.
    const recent = list.slice(-5);
    const counts = new Map<string, number>();
    for (const e of recent)
      counts.set(e.category_id!, (counts.get(e.category_id!) ?? 0) + 1);
    const [category_id, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const last = [...list].reverse().find((e) => e.category_id === category_id);
    lookup.set(text, {
      category_id,
      share: n / recent.length,
      count: list.length,
      payee: last?.payee ?? "",
    });
  }
  const stats: PersonalModel["stats"] = {
    examples: usable.length,
    holdout: 0,
    personalAccuracy: null,
    baselineAccuracy: null,
    usesClassifier: false,
  };
  const classes = new Set(usable.map((e) => e.category_id));
  if (usable.length < MIN_EXAMPLES || classes.size < 2)
    return { lookup, classifier: null, stats };
  const rows = usable.map((e) => ({
    x: personalFeatures(
      e.merchant_text,
      e.amount / 100,
      baseScores(model, e.merchant_text, e.amount / 100),
    ),
    y: e.category_id!,
    e,
  }));
  const cut = Math.floor(rows.length * 0.8);
  const test = rows.slice(cut);
  const trial = train(rows.slice(0, cut));
  let good = 0,
    base = 0;
  for (const r of test) {
    const p = predictClassifier(trial, r.x);
    if (trial.classes[p.indexOf(Math.max(...p))] === r.y) good++;
    if (baseline(model, map, r.e.merchant_text, r.e.amount / 100) === r.y)
      base++;
  }
  stats.holdout = test.length;
  stats.personalAccuracy = test.length ? good / test.length : null;
  stats.baselineAccuracy = test.length ? base / test.length : null;
  stats.usesClassifier = test.length >= 4 && good >= base;
  return {
    lookup,
    classifier: stats.usesClassifier ? train(rows) : null,
    stats,
  };
}

/**
 * Cascade in the user's own categories: exact merchant corrections -> personal classifier -> brand/keyword rules ->
 * base model. Each tier must clear the review threshold; otherwise the best guess is returned for review.
 */
export function suggestCategory(
  personal: PersonalModel | null,
  model: LoadedModel | null,
  map: CategoryMap,
  merchant: string | null,
  amountAed: number,
  threshold = model?.review_threshold ?? DEFAULT_REVIEW_THRESHOLD,
): UserSuggestion {
  const text = merchantKey(merchant);
  const own = text ? personal?.lookup.get(text) : undefined;
  const payee = own?.payee || null;
  if (own) {
    const confidence = own.share * (own.count >= 2 ? 0.97 : 0.9);
    if (confidence >= threshold)
      return {
        category_id: own.category_id,
        canonical: null,
        confidence,
        decidedBy: "your corrections",
        needsReview: false,
        payee,
      };
  }
  const base = categorise(model, merchant, amountAed, undefined, threshold);
  const candidates: UserSuggestion[] = [];
  if (personal?.classifier && text) {
    const p = predictClassifier(
      personal.classifier,
      // Same features as training: base scores of the cleaned text.
      personalFeatures(text, amountAed, baseScores(model, text, amountAed)),
    );
    const best = p.indexOf(Math.max(...p));
    candidates.push({
      category_id: personal.classifier.classes[best],
      canonical: null,
      confidence: p[best],
      decidedBy: "personal model",
      needsReview: p[best] < threshold,
      payee,
    });
  }
  if (base.category)
    candidates.push({
      category_id: map[base.category] ?? null,
      canonical: base.category,
      confidence: base.confidence,
      decidedBy:
        base.decidedBy === "none" || base.decidedBy === "your corrections"
          ? "model"
          : base.decidedBy,
      needsReview: base.needsReview || !map[base.category],
      payee,
    });
  const confident = candidates.find((c) => !c.needsReview);
  if (confident) return confident;
  if (candidates.length)
    return candidates.reduce((a, c) => (c.confidence > a.confidence ? c : a));
  return {
    category_id: null,
    canonical: null,
    confidence: 0,
    decidedBy: "none",
    needsReview: true,
    payee,
  };
}
