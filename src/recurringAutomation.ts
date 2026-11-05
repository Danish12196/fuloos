import {
  balance,
  defaultRecurringPreferences,
  today,
  type Account,
  type AutoMatchSetting,
  type Ledger,
  type RecurringAmountType,
  type RecurringFrequency,
  type RecurringKind,
  type RecurringOccurrenceRecord,
  type RecurringPreferences,
  type RecurringSchedule,
  type Transaction,
} from "./domain.ts";
import {
  addDays,
  daysBetween,
  daysInMonth,
  firstStepOnOrAfter,
  formatIsoDate,
  generateOccurrences,
  occurrenceAtStep,
  parseIsoDate,
} from "./recurring.ts";

export const MAX_DETECTION_TRANSACTIONS = 5000;
export const DETECTION_BATCH_SIZE = 500;
export const AUTO_LINK_THRESHOLD = 0.88;
export const REVIEW_MATCH_THRESHOLD = 0.58;
export const AMBIGUITY_MARGIN = 0.12;

export type DetectableFrequency = Exclude<RecurringFrequency, "daily">;

export type RecurringCategoryHint =
  | "subscription"
  | "utilities"
  | "telecom"
  | "rent"
  | "salary"
  | "insurance"
  | "membership"
  | "other_recurring";

export interface NormalizedMerchant {
  key: string;
  displayName: string;
  tokens: string[];
  canonicalHint?: RecurringCategoryHint;
}

export interface PatternFeatures {
  merchant: NormalizedMerchant;
  type: RecurringKind;
  frequency: DetectableFrequency;
  observationCount: number;
  missedCycles: number;
  offCycleCount: number;
  meanResidualDays: number;
  maxResidualDays: number;
  amountMean: number;
  amountStdDev: number;
  amountCv: number;
  isExactFixed: boolean;
  accountConsistency: number;
  categoryName: string;
}

export interface PatternClassification {
  confidence: number;
  categoryHint: RecurringCategoryHint;
}

/**
 * Pluggable classifier contract so statistical/deterministic scoring can be
 * augmented or replaced by a trained ML classifier later without changing callers.
 */
export interface PatternClassifier {
  classify(features: PatternFeatures): PatternClassification;
}

export interface DetectedPattern {
  patternKey: string;
  merchantKey: string;
  displayName: string;
  type: RecurringKind;
  frequency: DetectableFrequency;
  amountType: RecurringAmountType;
  estimatedAmount: number;
  minAmount: number;
  maxAmount: number;
  confidence: number;
  confidenceTier: "high" | "medium";
  categoryHint: RecurringCategoryHint;
  accountId: string;
  categoryId: string | null;
  nextExpectedDate: string;
  explanation: string;
  supportingTransactions: Transaction[];
  draftSchedule: Omit<RecurringSchedule, "id">;
  historicalLinks: { occurrence_date: string; transaction_id: string }[];
}

export interface MatchCandidate {
  matchKey: string;
  schedule: RecurringSchedule;
  occurrenceDate: string;
  transaction: Transaction;
  confidence: number;
  decision: "auto_link" | "needs_review";
  reasons: string[];
  summaryReason: string;
  dayOffset: number;
  amountDiff: number;
}

export interface ReconciliationResult {
  autoLinks: MatchCandidate[];
  reviewCandidates: MatchCandidate[];
}

export interface ScheduleHistoryProfile {
  scheduleId: string;
  sampleCount: number;
  expectedAmount: number;
  lowAmount: number;
  highAmount: number;
  hasRange: boolean;
  medianOffsetDays: number;
  basisExplanation: string;
}

export interface ForecastItem {
  schedule: RecurringSchedule;
  scheduledDate: string;
  predictedDate: string;
  offsetDays: number;
  status: "overdue" | "due_today" | "upcoming" | "paid";
  isConfirmed: boolean;
  confirmation?: RecurringOccurrenceRecord;
  linkedTransaction?: Transaction;
  expectedAmount: number;
  lowAmount: number;
  highAmount: number;
  hasRange: boolean;
  explanation: string;
}

export interface HorizonSummary {
  days: 30 | 60 | 90;
  fromDate: string;
  toDate: string;
  unconfirmedCount: number;
  confirmedCount: number;
  expense: { expected: number; low: number; high: number };
  income: { expected: number; low: number; high: number };
  net: { expected: number; low: number; high: number };
}

export interface AccountBalanceProjection {
  account: Account;
  currentBalance: number;
  horizons: Record<
    30 | 60 | 90,
    {
      scheduledDelta: number;
      projectedBalance: number;
      lowBalance: number;
      highBalance: number;
      hasRange: boolean;
      upcomingCount: number;
    }
  >;
}

export interface IntelligentForecast {
  asOfDate: string;
  profiles: Record<string, ScheduleHistoryProfile>;
  upcomingItems: ForecastItem[];
  horizons: Record<30 | 60 | 90, HorizonSummary>;
  accountProjections: AccountBalanceProjection[];
  totalsProjection: {
    currentNetBalance: number;
    horizons: Record<
      30 | 60 | 90,
      {
        projectedNetBalance: number;
        lowNetBalance: number;
        highNetBalance: number;
        hasRange: boolean;
      }
    >;
  };
  monthlyCommitment: {
    fixedExpense: number;
    variableExpense: number;
    totalExpense: number;
    totalIncome: number;
    annualizedExpense: number;
  };
}

const NOISE_WORDS = new Set([
  "pos",
  "purchase",
  "card",
  "debit",
  "credit",
  "payment",
  "pymt",
  "pmt",
  "online",
  "ecom",
  "ecommerce",
  "direct",
  "standing",
  "order",
  "transfer",
  "trf",
  "ach",
  "wps",
  "autopay",
  "recurring",
  "www",
  "http",
  "https",
  "com",
  "net",
  "org",
  "llc",
  "pjsc",
  "fze",
  "fz",
  "ltd",
  "inc",
  "co",
  "ref",
  "txn",
  "trx",
  "auth",
  "terminal",
  "bill",
  "inv",
  "invoice",
  "cheque",
  "chq",
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
]);

const TRAILING_LOCATIONS = new Set([
  "dubai",
  "abudhabi",
  "sharjah",
  "ajman",
  "rak",
  "fujairah",
  "uae",
  "are",
  "ae",
  "nld",
  "irl",
  "usa",
  "gbr",
  "lux",
  "sgp",
]);

interface CanonicalAlias {
  match: (joined: string, tokens: string[]) => boolean;
  key: string;
  displayName: string;
  hint: RecurringCategoryHint;
}

const CANONICAL_ALIASES: CanonicalAlias[] = [
  {
    match: (_j, t) => t.includes("spinneys"),
    key: "spinneys",
    displayName: "Spinneys",
    hint: "other_recurring",
  },
  {
    match: (_j, t) => t.includes("carrefour"),
    key: "carrefour",
    displayName: "Carrefour",
    hint: "other_recurring",
  },
  {
    match: (_j, t) => t.includes("lulu"),
    key: "lulu",
    displayName: "LuLu Hypermarket",
    hint: "other_recurring",
  },
  {
    match: (j, t) =>
      t.includes("dewa") || j.includes("dubai electricity"),
    key: "dewa",
    displayName: "DEWA",
    hint: "utilities",
  },
  {
    match: (j, t) =>
      t.includes("addc") || j.includes("abu dhabi distribution"),
    key: "addc",
    displayName: "ADDC Utilities",
    hint: "utilities",
  },
  {
    match: (j, t) =>
      t.includes("sewa") || j.includes("sharjah electricity"),
    key: "sewa",
    displayName: "SEWA Utilities",
    hint: "utilities",
  },
  {
    match: (j, t) =>
      t.includes("empower") ||
      (t.includes("tabreed") && !t.includes("cafe")),
    key: "district cooling",
    displayName: "District Cooling",
    hint: "utilities",
  },
  {
    match: (j, t) =>
      t.includes("etisalat") ||
      j.includes("emirates telecom") ||
      (t.includes("eand") || (t[0] === "e" && t[1] === "and")),
    key: "etisalat",
    displayName: "e& (Etisalat)",
    hint: "telecom",
  },
  {
    match: (j, t) =>
      t.includes("du") || j.includes("emirates integrated telecom"),
    key: "du",
    displayName: "du",
    hint: "telecom",
  },
  {
    match: (j) => j.includes("virgin mobile"),
    key: "virgin mobile",
    displayName: "Virgin Mobile",
    hint: "telecom",
  },
  {
    match: (_j, t) => t.includes("netflix"),
    key: "netflix",
    displayName: "Netflix",
    hint: "subscription",
  },
  {
    match: (_j, t) => t.includes("spotify"),
    key: "spotify",
    displayName: "Spotify",
    hint: "subscription",
  },
  {
    match: (_j, t) => t.includes("anghami"),
    key: "anghami",
    displayName: "Anghami Plus",
    hint: "subscription",
  },
  {
    match: (j, t) =>
      t.includes("icloud") ||
      t.includes("itunes") ||
      (t.includes("apple") &&
        (j.includes("apple com") ||
          t.includes("services") ||
          t.includes("subscription"))),
    key: "apple services",
    displayName: "Apple Services",
    hint: "subscription",
  },
  {
    match: (j, t) =>
      t.includes("youtube") || j.includes("google youtube"),
    key: "youtube",
    displayName: "YouTube Premium",
    hint: "subscription",
  },
  {
    match: (j) =>
      j.includes("amazon prime") || j.includes("prime video"),
    key: "amazon prime",
    displayName: "Amazon Prime",
    hint: "subscription",
  },
  {
    match: (j) => j.includes("careem plus"),
    key: "careem plus",
    displayName: "Careem Plus",
    hint: "subscription",
  },
  {
    match: (j) => j.includes("deliveroo plus"),
    key: "deliveroo plus",
    displayName: "Deliveroo Plus",
    hint: "subscription",
  },
  {
    match: (_j, t) => t.includes("openai") || t.includes("chatgpt"),
    key: "openai",
    displayName: "OpenAI / ChatGPT",
    hint: "subscription",
  },
  {
    match: (_j, t) => t.includes("salik"),
    key: "salik",
    displayName: "Salik",
    hint: "other_recurring",
  },
];

function titleCase(words: string[]): string {
  return words
    .map((w) =>
      w.length <= 2 && w !== "du"
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

export function normalizeMerchant(raw: string): NormalizedMerchant {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { key: "", displayName: "", tokens: [] };
  }
  const cleaned = trimmed
    .normalize("NFKC")
    .toLowerCase()
    .replace(/e&/g, "eand")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\babu\s+dhabi\b/g, "abudhabi");

  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const joinedRaw = rawTokens.join(" ");

  for (const alias of CANONICAL_ALIASES) {
    if (alias.match(joinedRaw, rawTokens)) {
      return {
        key: alias.key,
        displayName: alias.displayName,
        tokens: alias.key.split(" "),
        canonicalHint: alias.hint,
      };
    }
  }

  // Filter out reference codes (pure numbers or mixed alphanumerics with >=2 digits) and noise boilerplate
  const nonCodeTokens = rawTokens.filter((tok) => {
    if (/^\d+$/.test(tok)) return false;
    const digitCount = (tok.match(/\d/g) ?? []).length;
    if (digitCount >= 2) return false;
    if (/^(ref|txn|trx|id|auth)\d*/.test(tok) && tok.length > 4) return false;
    return true;
  });

  let core = nonCodeTokens.filter((tok) => !NOISE_WORDS.has(tok));

  // Strip trailing location codes only when at least one non-location token precedes them
  while (core.length > 1 && TRAILING_LOCATIONS.has(core[core.length - 1])) {
    core.pop();
  }
  // Strip apple/google pay wallet prefixes when actual merchant follows
  if (
    core.length > 2 &&
    (core[0] === "apple" || core[0] === "google" || core[0] === "samsung") &&
    core[1] === "pay"
  ) {
    core = core.slice(2);
  }

  if (core.length === 0) {
    core = nonCodeTokens.slice(0, 2);
  }
  const finalTokens = core.slice(0, 4);
  const key = finalTokens.join(" ");
  return {
    key,
    displayName: finalTokens.length ? titleCase(finalTokens) : trimmed,
    tokens: finalTokens,
  };
}

export function merchantSimilarity(
  aInput: string | NormalizedMerchant,
  bInput: string | NormalizedMerchant,
): number {
  const a = typeof aInput === "string" ? normalizeMerchant(aInput) : aInput;
  const b = typeof bInput === "string" ? normalizeMerchant(bInput) : bInput;
  if (!a.key || !b.key) return 0;
  if (a.key === b.key) return 1;
  if (a.key.includes(b.key) || b.key.includes(a.key)) {
    const shorter = Math.min(a.tokens.length, b.tokens.length);
    const longer = Math.max(a.tokens.length, b.tokens.length);
    return shorter >= 1 ? 0.84 + 0.12 * (shorter / longer) : 0.85;
  }
  const setA = new Set(a.tokens);
  const setB = new Set(b.tokens);
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap++;
    else {
      for (const tb of setB) {
        if (t.length >= 4 && tb.length >= 4 && (t.startsWith(tb) || tb.startsWith(t))) {
          overlap += 0.8;
          break;
        }
      }
    }
  }
  const union = setA.size + setB.size - Math.min(overlap, Math.min(setA.size, setB.size));
  return union > 0 ? Math.min(1, overlap / union) : 0;
}

export function inferCategoryHint(
  merchant: NormalizedMerchant,
  type: RecurringKind,
  categoryName: string,
): RecurringCategoryHint {
  if (merchant.canonicalHint) return merchant.canonicalHint;
  const text = `${merchant.key} ${categoryName.toLowerCase()}`;
  if (type === "income" && /\b(salary|payroll|wage|stipend)\b/.test(text))
    return "salary";
  if (/\b(rent|landlord|ejari|lease|property|hoa|service charge)\b/.test(text))
    return "rent";
  if (/\b(utility|utilities|water|electricity|power|gas|cooling|chiller|dewa|sewa|addc)\b/.test(text))
    return "utilities";
  if (/\b(telecom|internet|broadband|fibre|fiber|mobile|du|etisalat)\b/.test(text))
    return "telecom";
  if (/\b(insurance|takaful|medical|health policy)\b/.test(text))
    return "insurance";
  if (/\b(gym|fitness|club|membership)\b/.test(text)) return "membership";
  if (
    /\b(subscription|plus|premium|cloud|stream|music|video|software|saas)\b/.test(
      text,
    )
  )
    return "subscription";
  return type === "income" ? "salary" : "other_recurring";
}

export const defaultDeterministicClassifier: PatternClassifier = {
  classify(f: PatternFeatures): PatternClassification {
    const tol =
      f.frequency === "weekly"
        ? 3
        : f.frequency === "monthly"
          ? 6
          : f.frequency === "quarterly"
            ? 10
            : 16;

    const intervalScore = Math.max(
      0,
      1 - (f.meanResidualDays / tol) * 0.65 - (f.maxResidualDays / tol) * 0.2,
    );

    const baseObs =
      f.observationCount >= 5
        ? 1
        : f.observationCount === 4
          ? 0.92
          : f.observationCount === 3
            ? 0.82
            : 0.72; // 2 observations (yearly)
    const missPenalty =
      f.missedCycles > 0
        ? Math.min(0.22, (f.missedCycles / (f.observationCount + f.missedCycles)) * 0.35)
        : 0;
    const observationScore = Math.max(0, baseObs - missPenalty);

    let amountScore: number;
    if (f.isExactFixed) amountScore = 1;
    else if (f.amountCv <= 0.05) amountScore = 0.96;
    else if (f.amountCv <= 0.2) amountScore = 0.88;
    else if (f.amountCv <= 0.4) amountScore = 0.74;
    else if (f.amountCv <= 0.6) amountScore = 0.52;
    else amountScore = 0.2;

    const totalForMerchant = f.observationCount + f.offCycleCount;
    const purityRatio =
      totalForMerchant > 0 ? f.observationCount / totalForMerchant : 0;
    const purityScore = purityRatio * 0.8 + f.accountConsistency * 0.2;

    const rawConfidence =
      intervalScore * 0.38 +
      observationScore * 0.26 +
      amountScore * 0.2 +
      purityScore * 0.16;

    const categoryHint = inferCategoryHint(
      f.merchant,
      f.type,
      f.categoryName,
    );
    const domainBoost =
      categoryHint !== "other_recurring" && rawConfidence >= 0.55 ? 0.03 : 0;

    return {
      confidence: Math.max(
        0,
        Math.min(0.99, Math.round((rawConfidence + domainBoost) * 100) / 100),
      ),
      categoryHint,
    };
  },
};

export function buildPatternKey(
  type: RecurringKind,
  merchantKey: string,
  frequency: DetectableFrequency,
): string {
  return `pat:${type}:${merchantKey}:${frequency}`;
}

export function buildMatchDismissKey(
  recurringId: string,
  occurrenceDate: string,
  transactionId: string,
): string {
  return `match:${recurringId}:${occurrenceDate}:${transactionId}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function meanAndStd(values: number[]): { mean: number; std: number; cv: number } {
  if (!values.length) return { mean: 0, std: 0, cv: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (values.length === 1 || mean === 0) return { mean, std: 0, cv: 0 };
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return { mean, std, cv: std / mean };
}

function predominantValue<T extends string | null>(values: T[]): {
  value: T;
  share: number;
} {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let bestVal = values[0];
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      bestVal = val;
      bestCount = count;
    }
  }
  return {
    value: bestVal,
    share: values.length ? bestCount / values.length : 1,
  };
}

interface CadenceFit {
  frequency: DetectableFrequency;
  anchorStart: string;
  matched: { step: number; occurrenceDate: string; tx: Transaction; residual: number }[];
  missedCycles: number;
  offCycleCount: number;
  meanResidualDays: number;
  maxResidualDays: number;
}

const MAX_RESIDUAL_BY_FREQ: Record<DetectableFrequency, number> = {
  weekly: 2,
  monthly: 6,
  quarterly: 10,
  yearly: 16,
};

function candidateAnchorStarts(
  sortedTxs: Transaction[],
  frequency: DetectableFrequency,
): string[] {
  const first = parseIsoDate(sortedTxs[0].date);
  if (!first) return [];
  if (frequency === "weekly") {
    const starts: string[] = [];
    for (let offset = -3; offset <= 3; offset++) {
      starts.push(addDays(sortedTxs[0].date, -7 + offset));
    }
    return starts;
  }

  const days = sortedTxs
    .map((t) => parseIsoDate(t.date)?.day ?? 1)
    .sort((a, b) => a - b);
  const hasMonthEnd = sortedTxs.some((t) => {
    const p = parseIsoDate(t.date);
    return p ? p.day === daysInMonth(p.year, p.month) && p.day >= 28 : false;
  });
  const candidateDays = new Set<number>([
    median(days),
    days[days.length - 1],
    days[0],
  ]);
  if (hasMonthEnd) candidateDays.add(31);

  const starts = new Set<string>();
  const monthOffsets =
    frequency === "monthly"
      ? [-1, 0]
      : frequency === "quarterly"
        ? [-3, -2, -1, 0]
        : [-12, 0];

  for (const mOff of monthOffsets) {
    const totalMonths = first.year * 12 + (first.month - 1) + mOff;
    const y = Math.floor(totalMonths / 12);
    const m = (((totalMonths % 12) + 12) % 12) + 1;
    if (y < 1970) continue;
    for (const d of candidateDays) {
      // Choose a starting month with full days when anchorDay is 29..31 so occurrenceAtStep preserves the high day anchor
      if (d > daysInMonth(y, m)) {
        const stepMonths =
          frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
        const prevTotal = totalMonths - stepMonths;
        const py = Math.floor(prevTotal / 12);
        const pm = (((prevTotal % 12) + 12) % 12) + 1;
        if (py >= 1970 && d <= daysInMonth(py, pm)) {
          starts.add(formatIsoDate(py, pm, d));
          continue;
        }
      }
      starts.add(formatIsoDate(y, m, Math.min(d, daysInMonth(y, m))));
    }
  }
  return [...starts];
}

function fitCadenceForCluster(
  sortedTxs: Transaction[],
  frequency: DetectableFrequency,
): CadenceFit | null {
  const minObs = frequency === "yearly" ? 2 : 3;
  if (sortedTxs.length < minObs) return null;

  const spanDays = daysBetween(
    sortedTxs[0].date,
    sortedTxs[sortedTxs.length - 1].date,
  );
  const minSpan =
    frequency === "weekly"
      ? 11
      : frequency === "monthly"
        ? 48
        : frequency === "quarterly"
          ? 155
          : 340;
  if (spanDays < minSpan) return null;

  const tol = MAX_RESIDUAL_BY_FREQ[frequency];
  const anchorCandidates = candidateAnchorStarts(sortedTxs, frequency);
  let best: CadenceFit | null = null;
  let bestObjective = -Infinity;

  for (const anchorStart of anchorCandidates) {
    const byStep = new Map<
      number,
      { step: number; occurrenceDate: string; tx: Transaction; residual: number }
    >();
    let offCycleCount = 0;

    for (const tx of sortedTxs) {
      const kAfter = firstStepOnOrAfter(anchorStart, frequency, tx.date);
      const occAfter = occurrenceAtStep(anchorStart, frequency, kAfter);
      let chosenStep = kAfter;
      let chosenOcc = occAfter;
      let chosenRes = Math.abs(daysBetween(occAfter, tx.date));

      if (kAfter > 0) {
        const occBefore = occurrenceAtStep(anchorStart, frequency, kAfter - 1);
        const resBefore = Math.abs(daysBetween(occBefore, tx.date));
        if (resBefore < chosenRes) {
          chosenStep = kAfter - 1;
          chosenOcc = occBefore;
          chosenRes = resBefore;
        }
      }

      if (chosenRes <= tol) {
        const existing = byStep.get(chosenStep);
        if (!existing) {
          byStep.set(chosenStep, {
            step: chosenStep,
            occurrenceDate: chosenOcc,
            tx,
            residual: chosenRes,
          });
        } else {
          offCycleCount++;
          if (chosenRes < existing.residual) {
            byStep.set(chosenStep, {
              step: chosenStep,
              occurrenceDate: chosenOcc,
              tx,
              residual: chosenRes,
            });
          }
        }
      } else {
        offCycleCount++;
      }
    }

    const matched = [...byStep.values()].sort((a, b) => a.step - b.step);
    if (matched.length < minObs) continue;

    // Verify step gaps: allow at most 1 missed cycle in a row (step delta <= 2)
    let maxStepGap = 1;
    for (let i = 1; i < matched.length; i++) {
      const gap = matched[i].step - matched[i - 1].step;
      if (gap > maxStepGap) maxStepGap = gap;
    }
    if (maxStepGap > 2) continue;

    const expectedSpanSteps =
      matched[matched.length - 1].step - matched[0].step + 1;
    const missedCycles = expectedSpanSteps - matched.length;
    if (missedCycles > Math.floor(matched.length * 0.5)) continue;
    if (offCycleCount > Math.max(1, Math.floor(matched.length * 0.35)))
      continue;

    const meanResidualDays =
      matched.reduce((s, m) => s + m.residual, 0) / matched.length;
    const maxResidualDays = matched.reduce(
      (mx, m) => Math.max(mx, m.residual),
      0,
    );

    const objective =
      matched.length * 4 -
      missedCycles * 2.5 -
      offCycleCount * 3 -
      meanResidualDays * 0.6;
    if (objective > bestObjective) {
      bestObjective = objective;
      best = {
        frequency,
        anchorStart,
        matched,
        missedCycles,
        offCycleCount,
        meanResidualDays,
        maxResidualDays,
      };
    }
  }

  return best;
}

/**
 * Analyzes historical ledger transactions in bounded batches to discover
 * weekly, monthly, quarterly, and yearly recurring expenses and income.
 */
export function detectRecurringPatterns(
  ledger: Ledger,
  options: {
    asOfDate?: string;
    classifier?: PatternClassifier;
    minConfidence?: number;
  } = {},
): DetectedPattern[] {
  const prefs: RecurringPreferences =
    ledger.recurring_prefs ?? defaultRecurringPreferences;
  if (prefs.auto_detect === "off") return [];

  const asOfDate = options.asOfDate ?? today();
  const classifier = options.classifier ?? defaultDeterministicClassifier;
  const minConfidence = options.minConfidence ?? 0.55;
  const dismissed = new Set(prefs.dismissed_keys);
  const linkedTxIds = new Set(
    (ledger.recurring_occurrences ?? []).map((o) => o.transaction_id),
  );

  // Bounded batch extraction of eligible historical transactions (most recent MAX_DETECTION_TRANSACTIONS)
  const sortedCandidates = ledger.transactions
    .filter(
      (t) =>
        (t.type === "expense" || t.type === "income") &&
        !linkedTxIds.has(t.id) &&
        t.payee.trim().length > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .slice(-MAX_DETECTION_TRANSACTIONS);

  interface MerchantCluster {
    type: RecurringKind;
    merchant: NormalizedMerchant;
    txs: Transaction[];
  }
  const clusters: MerchantCluster[] = [];

  for (
    let offset = 0;
    offset < sortedCandidates.length;
    offset += DETECTION_BATCH_SIZE
  ) {
    const batch = sortedCandidates.slice(offset, offset + DETECTION_BATCH_SIZE);
    for (const tx of batch) {
      const type = tx.type as RecurringKind;
      const norm = normalizeMerchant(tx.payee);
      if (!norm.key) continue;

      let target = clusters.find(
        (c) => c.type === type && c.merchant.key === norm.key,
      );
      if (!target) {
        target = clusters.find(
          (c) =>
            c.type === type && merchantSimilarity(c.merchant, norm) >= 0.85,
        );
      }
      if (target) {
        target.txs.push(tx);
      } else {
        clusters.push({ type, merchant: norm, txs: [tx] });
      }
    }
  }

  const existingSchedules = ledger.recurring ?? [];
  const results: DetectedPattern[] = [];

  for (const cluster of clusters) {
    if (cluster.txs.length < 2) continue;

    // Evaluate all 4 detectable frequencies and pick highest-confidence valid fit
    let bestCandidate: DetectedPattern | null = null;

    for (const frequency of [
      "monthly",
      "weekly",
      "quarterly",
      "yearly",
    ] as const) {
      const patternKey = buildPatternKey(
        cluster.type,
        cluster.merchant.key,
        frequency,
      );
      if (dismissed.has(patternKey)) continue;

      // Skip if an existing schedule already covers this merchant + type + frequency
      const alreadyScheduled = existingSchedules.some(
        (s) =>
          s.type === cluster.type &&
          s.frequency === frequency &&
          merchantSimilarity(s.name, cluster.merchant) >= 0.78,
      );
      if (alreadyScheduled) continue;

      const fit = fitCadenceForCluster(cluster.txs, frequency);
      if (!fit) continue;

      const matchedTxs = fit.matched.map((m) => m.tx);
      const amounts = matchedTxs.map((t) => t.amount);
      const minAmount = Math.min(...amounts);
      const maxAmount = Math.max(...amounts);
      const { mean, std, cv } = meanAndStd(amounts);

      // Yearly with only 2 observations requires consistent amounts (<= 12% CV) to avoid coincidence false positives
      if (frequency === "yearly" && fit.matched.length === 2 && cv > 0.12)
        continue;
      // Reject high-randomness spend
      if (cv > 0.62) continue;

      // Also check that the pattern hasn't gone stale (> 2.5 cycles since last payment)
      const lastMatch = fit.matched[fit.matched.length - 1];
      const nextStepDate = occurrenceAtStep(
        fit.anchorStart,
        frequency,
        lastMatch.step + 1,
      );
      const secondNextStepDate = occurrenceAtStep(
        fit.anchorStart,
        frequency,
        lastMatch.step + 2,
      );
      if (asOfDate > addDays(secondNextStepDate, 15)) continue;

      const isExactFixed = minAmount === maxAmount;
      const isNearFixed =
        !isExactFixed &&
        mean > 0 &&
        (maxAmount - minAmount) / mean <= 0.025 &&
        amounts.filter((a) => a === amounts[amounts.length - 1]).length >=
          amounts.length - 1;
      const amountType: RecurringAmountType =
        isExactFixed || isNearFixed ? "fixed" : "variable";

      // Recency-weighted integer fils estimate for variable bills, latest/mode for fixed
      const recentSlice = amounts.slice(-6);
      let weightedSum = 0;
      let weightTotal = 0;
      recentSlice.forEach((amt, idx) => {
        const w = idx + 1;
        weightedSum += amt * w;
        weightTotal += w;
      });
      const estimatedAmount =
        amountType === "fixed"
          ? amounts[amounts.length - 1]
          : Math.round(weightedSum / weightTotal);

      const { value: accountId, share: accountConsistency } = predominantValue(
        matchedTxs.map((t) => t.account_id),
      );
      const nonNullCategories = matchedTxs
        .map((t) => t.category_id)
        .filter((c): c is string => c !== null);
      const categoryId = nonNullCategories.length
        ? predominantValue(nonNullCategories).value
        : null;
      const categoryName =
        ledger.categories.find((c) => c.id === categoryId)?.name ?? "";

      const classification = classifier.classify({
        merchant: cluster.merchant,
        type: cluster.type,
        frequency,
        observationCount: fit.matched.length,
        missedCycles: fit.missedCycles,
        offCycleCount: fit.offCycleCount,
        meanResidualDays: fit.meanResidualDays,
        maxResidualDays: fit.maxResidualDays,
        amountMean: mean,
        amountStdDev: std,
        amountCv: cv,
        isExactFixed: isExactFixed || isNearFixed,
        accountConsistency,
        categoryName,
      });

      if (classification.confidence < minConfidence) continue;

      // Start the draft schedule at the beginning of the contiguous recent matched run
      // so accepting links those recent payments cleanly without creating old missed-cycle overdue flags.
      let contiguousStartIdx = fit.matched.length - 1;
      while (
        contiguousStartIdx > 0 &&
        fit.matched[contiguousStartIdx].step -
          fit.matched[contiguousStartIdx - 1].step ===
          1
      ) {
        contiguousStartIdx--;
      }
      const contiguousMatches = fit.matched.slice(contiguousStartIdx);
      let scheduleStartDate = contiguousMatches[0].occurrenceDate;
      // Preserve month-end day anchor (e.g. 31st) if the first contiguous month was a shorter month (e.g. Feb 28)
      const anchorParsed = parseIsoDate(fit.anchorStart);
      const startParsed = parseIsoDate(scheduleStartDate);
      if (
        anchorParsed &&
        startParsed &&
        anchorParsed.day > startParsed.day &&
        contiguousMatches.length === 1
      ) {
        scheduleStartDate = nextStepDate;
      }

      const historicalLinks = contiguousMatches
        .filter((m) => m.occurrenceDate >= scheduleStartDate)
        .map((m) => ({
          occurrence_date: m.occurrenceDate,
          transaction_id: m.tx.id,
        }));

      const nextExpectedDate =
        nextStepDate >= asOfDate
          ? nextStepDate
          : occurrenceAtStep(
              fit.anchorStart,
              frequency,
              firstStepOnOrAfter(fit.anchorStart, frequency, asOfDate),
            );

      const explanationParts = [
        `${fit.matched.length} ${frequency} ${cluster.type === "income" ? "deposits" : "payments"}`,
        amountType === "fixed"
          ? "consistent amount"
          : `variable range`,
      ];
      if (fit.meanResidualDays <= 1.5) {
        explanationParts.push("steady billing date");
      } else {
        explanationParts.push(
          `±${Math.round(fit.meanResidualDays)}d date variance`,
        );
      }
      if (fit.missedCycles > 0) {
        explanationParts.push(
          `${fit.missedCycles} skipped cycle${fit.missedCycles > 1 ? "s" : ""}`,
        );
      }

      const candidate: DetectedPattern = {
        patternKey,
        merchantKey: cluster.merchant.key,
        displayName: cluster.merchant.displayName,
        type: cluster.type,
        frequency,
        amountType,
        estimatedAmount,
        minAmount,
        maxAmount,
        confidence: classification.confidence,
        confidenceTier: classification.confidence >= 0.75 ? "high" : "medium",
        categoryHint: classification.categoryHint,
        accountId,
        categoryId,
        nextExpectedDate,
        explanation: explanationParts.join(" · "),
        supportingTransactions: matchedTxs
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date)),
        draftSchedule: {
          name: cluster.merchant.displayName,
          type: cluster.type,
          amount: estimatedAmount,
          amount_type: amountType,
          account_id: accountId,
          category_id: categoryId,
          frequency,
          start_date: scheduleStartDate,
          end_date: null,
          status: "active",
          notes: `Detected from ${fit.matched.length} historical transactions`,
        },
        historicalLinks,
      };

      if (!bestCandidate || candidate.confidence > bestCandidate.confidence) {
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) results.push(bestCandidate);
  }

  return results.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      b.supportingTransactions.length - a.supportingTransactions.length ||
      a.displayName.localeCompare(b.displayName),
  );
}

const MATCH_WINDOW_BY_FREQ: Record<
  RecurringFrequency,
  { earlyDays: number; lateDays: number }
> = {
  daily: { earlyDays: 1, lateDays: 1 },
  weekly: { earlyDays: 3, lateDays: 3 },
  monthly: { earlyDays: 7, lateDays: 14 },
  quarterly: { earlyDays: 10, lateDays: 20 },
  yearly: { earlyDays: 14, lateDays: 30 },
};

/**
 * Reconciles unlinked transactions against active recurring schedules.
 * Deterministic, idempotent, and strictly non-destructive: never creates
 * ledger transactions and never mutates transaction amounts.
 */
export function reconcileTransactions(
  ledger: Ledger,
  options: {
    asOfDate?: string;
    modeOverride?: AutoMatchSetting;
  } = {},
): ReconciliationResult {
  const prefs = ledger.recurring_prefs ?? defaultRecurringPreferences;
  const mode = options.modeOverride ?? prefs.auto_match;
  if (mode === "off") return { autoLinks: [], reviewCandidates: [] };

  const asOfDate = options.asOfDate ?? today();
  const dismissed = new Set(prefs.dismissed_keys);
  const occurrences = ledger.recurring_occurrences ?? [];
  const linkedTxIds = new Set(occurrences.map((o) => o.transaction_id));
  const confirmedKeys = new Set(
    occurrences.map((o) => `${o.recurring_id}:${o.occurrence_date}`),
  );
  const txById = new Map(ledger.transactions.map((t) => [t.id, t]));

  const unlinkedTxs = ledger.transactions.filter(
    (t) =>
      (t.type === "expense" || t.type === "income") && !linkedTxIds.has(t.id),
  );
  if (!unlinkedTxs.length) return { autoLinks: [], reviewCandidates: [] };

  const activeSchedules = (ledger.recurring ?? []).filter(
    (s) => s.status === "active",
  );
  if (!activeSchedules.length) return { autoLinks: [], reviewCandidates: [] };

  let minTxDate = unlinkedTxs[0].date;
  let maxTxDate = unlinkedTxs[0].date;
  for (const t of unlinkedTxs) {
    if (t.date < minTxDate) minTxDate = t.date;
    if (t.date > maxTxDate) maxTxDate = t.date;
  }

  // Precompute known merchant signatures & historical amount baselines per schedule
  const scheduleMeta = new Map<
    string,
    {
      merchants: NormalizedMerchant[];
      baselineAmount: number;
      minHistAmount: number;
      maxHistAmount: number;
      histCount: number;
    }
  >();

  for (const schedule of activeSchedules) {
    const schedMerchants: NormalizedMerchant[] = [
      normalizeMerchant(schedule.name),
    ];
    const histAmounts: number[] = [];
    for (const occ of occurrences) {
      if (occ.recurring_id !== schedule.id) continue;
      const linked = txById.get(occ.transaction_id);
      if (!linked) continue;
      histAmounts.push(linked.amount);
      if (linked.payee.trim()) {
        const norm = normalizeMerchant(linked.payee);
        if (
          norm.key &&
          !schedMerchants.some((m) => m.key === norm.key)
        ) {
          schedMerchants.push(norm);
        }
      }
    }
    const baselineAmount = histAmounts.length
      ? Math.round(histAmounts.reduce((s, v) => s + v, 0) / histAmounts.length)
      : schedule.amount;
    scheduleMeta.set(schedule.id, {
      merchants: schedMerchants,
      baselineAmount,
      minHistAmount: histAmounts.length
        ? Math.min(...histAmounts)
        : schedule.amount,
      maxHistAmount: histAmounts.length
        ? Math.max(...histAmounts)
        : schedule.amount,
      histCount: histAmounts.length,
    });
  }

  const allScored: (MatchCandidate & {
    merchantScore: number;
    sameAccount: boolean;
    safeAmountForAuto: boolean;
  })[] = [];

  for (const schedule of activeSchedules) {
    const window = MATCH_WINDOW_BY_FREQ[schedule.frequency];
    const fromWindow = addDays(minTxDate, -window.lateDays);
    const toWindow = addDays(
      maxTxDate > asOfDate ? maxTxDate : asOfDate,
      window.earlyDays,
    );
    const occDates = generateOccurrences(schedule, fromWindow, toWindow);
    const meta = scheduleMeta.get(schedule.id)!;

    for (const occDate of occDates) {
      const occKey = `${schedule.id}:${occDate}`;
      if (confirmedKeys.has(occKey)) continue;

      for (const tx of unlinkedTxs) {
        if (tx.type !== schedule.type) continue;
        const matchKey = buildMatchDismissKey(schedule.id, occDate, tx.id);
        if (dismissed.has(matchKey)) continue;

        const dayOffset = daysBetween(occDate, tx.date); // negative = early, positive = late
        if (dayOffset < -window.earlyDays || dayOffset > window.lateDays)
          continue;

        const txMerchant = normalizeMerchant(tx.payee);
        let merchantScore = 0;
        for (const m of meta.merchants) {
          merchantScore = Math.max(
            merchantScore,
            merchantSimilarity(txMerchant, m),
          );
        }

        const absDays = Math.abs(dayOffset);
        const maxWindow = Math.max(window.earlyDays, window.lateDays);
        const dateScore =
          absDays === 0
            ? 1
            : absDays <= 2
              ? 0.95
              : Math.max(0.35, 1 - (absDays / maxWindow) * 0.65);

        const refAmount =
          schedule.amount_type === "variable"
            ? meta.baselineAmount || schedule.amount
            : schedule.amount;
        const amountDiff = tx.amount - refAmount;
        const relDiff =
          refAmount > 0
            ? Math.abs(amountDiff) / refAmount
            : tx.amount === 0
              ? 0
              : 1;

        let amountScore: number;
        let safeAmountForAuto = false;
        if (schedule.amount_type === "fixed") {
          if (tx.amount === schedule.amount) {
            amountScore = 1;
            safeAmountForAuto = true;
          } else if (relDiff <= 0.03) {
            amountScore = 0.82;
          } else if (relDiff <= 0.12) {
            amountScore = 0.55;
          } else if (relDiff <= 0.25) {
            amountScore = 0.3;
          } else {
            amountScore = 0.05;
          }
        } else {
          const lowBound = Math.round(
            Math.min(meta.minHistAmount, refAmount) * 0.8,
          );
          const highBound = Math.round(
            Math.max(meta.maxHistAmount, refAmount) * 1.25,
          );
          if (
            (tx.amount >= lowBound && tx.amount <= highBound) ||
            relDiff <= 0.25
          ) {
            amountScore = relDiff <= 0.1 ? 0.96 : 0.88;
            safeAmountForAuto = tx.amount > 0 && relDiff <= 0.3;
          } else if (relDiff <= 0.5) {
            amountScore = 0.65;
          } else {
            amountScore = 0.3;
          }
        }

        // Require at least meaningful payee similarity OR strong category+account+exact-amount alignment
        const sameAccount = tx.account_id === schedule.account_id;
        const sameCategory =
          Boolean(schedule.category_id) &&
          tx.category_id === schedule.category_id;
        if (merchantScore < 0.35 && !(sameAccount && amountScore >= 0.95 && absDays <= 2))
          continue;

        const accountScore = sameAccount ? 1 : 0.2;
        const categoryScore =
          !schedule.category_id || !tx.category_id
            ? 0.7
            : sameCategory
              ? 1
              : 0.3;

        let rawConfidence =
          merchantScore * 0.42 +
          dateScore * 0.24 +
          amountScore * 0.22 +
          accountScore * 0.08 +
          categoryScore * 0.04;

        // Hard safety caps so cross-account or unexpected fixed-bill amount changes ask for confirmation
        if (!sameAccount) rawConfidence = Math.min(rawConfidence, 0.82);
        if (!safeAmountForAuto) rawConfidence = Math.min(rawConfidence, 0.83);
        if (merchantScore < 0.75) rawConfidence = Math.min(rawConfidence, 0.84);

        const confidence =
          Math.round(Math.max(0, Math.min(0.99, rawConfidence)) * 100) / 100;
        if (confidence < REVIEW_MATCH_THRESHOLD) continue;

        const reasons: string[] = [];
        if (merchantScore >= 0.95) reasons.push("payee match");
        else if (merchantScore >= 0.6) reasons.push("similar payee");
        else reasons.push("payee differs (matched by amount & date)");

        if (dayOffset === 0) reasons.push("on scheduled date");
        else if (dayOffset < 0)
          reasons.push(`${Math.abs(dayOffset)}d early`);
        else reasons.push(`${dayOffset}d after due date`);

        if (tx.amount === schedule.amount) reasons.push("exact amount");
        else if (schedule.amount_type === "variable")
          reasons.push("variable bill amount");
        else reasons.push("amount differs from schedule");

        if (!sameAccount) reasons.push("different account");

        allScored.push({
          matchKey,
          schedule,
          occurrenceDate: occDate,
          transaction: tx,
          confidence,
          decision: "needs_review",
          reasons,
          summaryReason: reasons.join(" · "),
          dayOffset,
          amountDiff,
          merchantScore,
          sameAccount,
          safeAmountForAuto,
        });
      }
    }
  }

  // Sort by highest confidence, then smallest date offset
  allScored.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      Math.abs(a.dayOffset) - Math.abs(b.dayOffset) ||
      a.occurrenceDate.localeCompare(b.occurrenceDate),
  );

  // Measure runner-up margins per occurrence and per transaction to detect ambiguity
  const bestForOcc = new Map<string, number>();
  const secondForOcc = new Map<string, number>();
  const bestForTx = new Map<string, number>();
  const secondForTx = new Map<string, number>();

  for (const c of allScored) {
    const occKey = `${c.schedule.id}:${c.occurrenceDate}`;
    if (!bestForOcc.has(occKey)) bestForOcc.set(occKey, c.confidence);
    else if (!secondForOcc.has(occKey)) secondForOcc.set(occKey, c.confidence);

    if (!bestForTx.has(c.transaction.id))
      bestForTx.set(c.transaction.id, c.confidence);
    else if (!secondForTx.has(c.transaction.id))
      secondForTx.set(c.transaction.id, c.confidence);
  }

  const assignedOcc = new Set<string>();
  const assignedTx = new Set<string>();
  const autoLinks: MatchCandidate[] = [];
  const reviewCandidates: MatchCandidate[] = [];

  for (const c of allScored) {
    const occKey = `${c.schedule.id}:${c.occurrenceDate}`;
    if (assignedOcc.has(occKey) || assignedTx.has(c.transaction.id)) continue;

    const occRunnerUp = secondForOcc.get(occKey) ?? 0;
    const txRunnerUp = secondForTx.get(c.transaction.id) ?? 0;
    const hasCompetingCandidate =
      c.confidence - occRunnerUp < AMBIGUITY_MARGIN ||
      c.confidence - txRunnerUp < AMBIGUITY_MARGIN;

    const canAutoLink =
      mode === "auto" &&
      c.confidence >= AUTO_LINK_THRESHOLD &&
      c.merchantScore >= 0.75 &&
      c.sameAccount &&
      c.safeAmountForAuto &&
      !hasCompetingCandidate;

    if (canAutoLink) {
      assignedOcc.add(occKey);
      assignedTx.add(c.transaction.id);
      autoLinks.push({
        matchKey: c.matchKey,
        schedule: c.schedule,
        occurrenceDate: c.occurrenceDate,
        transaction: c.transaction,
        confidence: c.confidence,
        decision: "auto_link",
        reasons: c.reasons,
        summaryReason: `Auto-matched (${Math.round(c.confidence * 100)}%): ${c.summaryReason}`,
        dayOffset: c.dayOffset,
        amountDiff: c.amountDiff,
      });
    } else {
      const reviewReasons = hasCompetingCandidate
        ? [...c.reasons, "multiple possible matches"]
        : c.reasons;
      assignedOcc.add(occKey);
      assignedTx.add(c.transaction.id);
      reviewCandidates.push({
        matchKey: c.matchKey,
        schedule: c.schedule,
        occurrenceDate: c.occurrenceDate,
        transaction: c.transaction,
        confidence: c.confidence,
        decision: "needs_review",
        reasons: reviewReasons,
        summaryReason: reviewReasons.join(" · "),
        dayOffset: c.dayOffset,
        amountDiff: c.amountDiff,
      });
    }
  }

  return { autoLinks, reviewCandidates };
}

function monthlyMultiplier(frequency: RecurringFrequency): number {
  switch (frequency) {
    case "daily":
      return 30.4375;
    case "weekly":
      return 52 / 12;
    case "monthly":
      return 1;
    case "quarterly":
      return 1 / 3;
    case "yearly":
      return 1 / 12;
  }
}

export function analyzeScheduleHistory(
  schedule: RecurringSchedule,
  ledger: Ledger,
): ScheduleHistoryProfile {
  const txById = new Map(ledger.transactions.map((t) => [t.id, t]));
  const links = (ledger.recurring_occurrences ?? [])
    .filter((o) => o.recurring_id === schedule.id)
    .slice()
    .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date));

  const linkedSamples: { amount: number; offsetDays: number }[] = [];
  for (const occ of links) {
    const tx = txById.get(occ.transaction_id);
    if (!tx) continue;
    const rawOffset = daysBetween(occ.occurrence_date, tx.date);
    const clampedOffset = Math.max(-14, Math.min(21, rawOffset));
    linkedSamples.push({ amount: tx.amount, offsetDays: clampedOffset });
  }

  const recent = linkedSamples.slice(-12);
  const sampleCount = recent.length;
  const medianOffsetDays =
    sampleCount >= 2 ? median(recent.map((s) => s.offsetDays)) : 0;

  if (schedule.amount_type === "fixed") {
    return {
      scheduleId: schedule.id,
      sampleCount,
      expectedAmount: schedule.amount,
      lowAmount: schedule.amount,
      highAmount: schedule.amount,
      hasRange: false,
      medianOffsetDays,
      basisExplanation:
        sampleCount >= 2
          ? `Fixed ${schedule.frequency} schedule · ${sampleCount} recorded payments${medianOffsetDays !== 0 ? ` (typically ${medianOffsetDays > 0 ? `+${medianOffsetDays}d after` : `${Math.abs(medianOffsetDays)}d before`} due date)` : ""}`
          : `Fixed ${schedule.frequency} schedule`,
    };
  }

  // Variable schedule estimation using historical amounts
  if (sampleCount >= 2) {
    let weightedSum = 0;
    let weightTotal = 0;
    recent.forEach((s, idx) => {
      const w = idx + 1;
      weightedSum += s.amount * w;
      weightTotal += w;
    });
    const expectedAmount = Math.round(weightedSum / weightTotal);
    const amounts = recent.map((s) => s.amount);
    const minObs = Math.min(...amounts);
    const maxObs = Math.max(...amounts);
    const lowAmount = minObs === maxObs ? Math.round(expectedAmount * 0.95) : minObs;
    const highAmount = minObs === maxObs ? Math.round(expectedAmount * 1.05) : maxObs;
    return {
      scheduleId: schedule.id,
      sampleCount,
      expectedAmount,
      lowAmount,
      highAmount,
      hasRange: lowAmount !== highAmount,
      medianOffsetDays,
      basisExplanation: `Estimated from ${sampleCount} historical bills${medianOffsetDays !== 0 ? ` · typically clears ${medianOffsetDays > 0 ? `${medianOffsetDays}d after` : `${Math.abs(medianOffsetDays)}d before`} due date` : ""}`,
    };
  }

  const base = recent[0]?.amount ?? schedule.amount;
  const lowAmount = Math.max(0, Math.round(base * 0.85));
  const highAmount = Math.round(base * 1.15);
  return {
    scheduleId: schedule.id,
    sampleCount,
    expectedAmount: base,
    lowAmount,
    highAmount,
    hasRange: base > 0,
    medianOffsetDays: 0,
    basisExplanation:
      sampleCount === 1
        ? "Variable bill · ±15% range from 1 recorded payment"
        : "Variable bill · ±15% range around scheduled estimate until 2+ bills are recorded",
  };
}

/**
 * Generates historical-aware 30/60/90-day recurring forecasts and projected
 * account balances while keeping recorded transactions strictly separate.
 */
export function buildIntelligentForecast(
  ledger: Ledger,
  asOfDate: string = today(),
): IntelligentForecast {
  const schedules = (ledger.recurring ?? []).filter(
    (s) => s.status === "active",
  );
  const occurrences = ledger.recurring_occurrences ?? [];
  const txById = new Map(ledger.transactions.map((t) => [t.id, t]));
  const linkByKey = new Map(
    occurrences.map((o) => [`${o.recurring_id}:${o.occurrence_date}`, o]),
  );

  const profiles: Record<string, ScheduleHistoryProfile> = {};
  for (const s of schedules) {
    profiles[s.id] = analyzeScheduleHistory(s, ledger);
  }

  const maxHorizonDate = addDays(asOfDate, 90);
  const items: ForecastItem[] = [];

  for (const schedule of schedules) {
    const profile = profiles[schedule.id];
    const start =
      schedule.start_date < asOfDate ? schedule.start_date : asOfDate;
    const dates = generateOccurrences(schedule, start, maxHorizonDate);

    for (const date of dates) {
      const confirmation = linkByKey.get(`${schedule.id}:${date}`);
      // Past confirmed occurrences before asOfDate belong to History, not upcoming forecast
      if (date < asOfDate && confirmation) continue;

      const linkedTransaction = confirmation
        ? txById.get(confirmation.transaction_id)
        : undefined;
      const isConfirmed = Boolean(confirmation);
      const predictedDate = isConfirmed
        ? linkedTransaction?.date ?? date
        : profile.medianOffsetDays !== 0
          ? addDays(date, profile.medianOffsetDays)
          : date;

      const status: ForecastItem["status"] = isConfirmed
        ? "paid"
        : date < asOfDate
          ? "overdue"
          : date === asOfDate
            ? "due_today"
            : "upcoming";

      const expectedAmount = isConfirmed
        ? linkedTransaction?.amount ?? schedule.amount
        : profile.expectedAmount;
      const lowAmount = isConfirmed ? expectedAmount : profile.lowAmount;
      const highAmount = isConfirmed ? expectedAmount : profile.highAmount;

      const explanation = isConfirmed
        ? `Matched to recorded transaction${linkedTransaction?.payee ? ` "${linkedTransaction.payee}"` : ""} (excluded from remaining forecast to prevent double-counting)`
        : profile.basisExplanation;

      items.push({
        schedule,
        scheduledDate: date,
        predictedDate,
        offsetDays: profile.medianOffsetDays,
        status,
        isConfirmed,
        confirmation,
        linkedTransaction,
        expectedAmount,
        lowAmount,
        highAmount,
        hasRange: !isConfirmed && profile.hasRange,
        explanation,
      });
    }
  }

  items.sort(
    (a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      a.schedule.name.localeCompare(b.schedule.name),
  );

  const buildHorizon = (days: 30 | 60 | 90): HorizonSummary => {
    const toDate = addDays(asOfDate, days);
    const inWindow = items.filter(
      (it) => it.scheduledDate >= asOfDate && it.scheduledDate <= toDate,
    );
    const expense = { expected: 0, low: 0, high: 0 };
    const income = { expected: 0, low: 0, high: 0 };
    let unconfirmedCount = 0;
    let confirmedCount = 0;

    for (const it of inWindow) {
      if (it.isConfirmed) {
        confirmedCount++;
        // Already recorded in ledger transactions & account balances — never count again!
        continue;
      }
      unconfirmedCount++;
      if (it.schedule.type === "income") {
        income.expected += it.expectedAmount;
        income.low += it.lowAmount;
        income.high += it.highAmount;
      } else {
        expense.expected += it.expectedAmount;
        expense.low += it.lowAmount;
        expense.high += it.highAmount;
      }
    }

    return {
      days,
      fromDate: asOfDate,
      toDate,
      unconfirmedCount,
      confirmedCount,
      expense,
      income,
      net: {
        expected: income.expected - expense.expected,
        // Worst-case net = low income minus high expense; best-case net = high income minus low expense
        low: income.low - expense.high,
        high: income.high - expense.low,
      },
    };
  };

  const horizons: Record<30 | 60 | 90, HorizonSummary> = {
    30: buildHorizon(30),
    60: buildHorizon(60),
    90: buildHorizon(90),
  };

  const accountProjections: AccountBalanceProjection[] = ledger.accounts.map(
    (account) => {
      const currentBalance = balance(account, ledger.transactions);
      const calcForDays = (days: 30 | 60 | 90) => {
        const toDate = addDays(asOfDate, days);
        const acctItems = items.filter(
          (it) =>
            !it.isConfirmed &&
            it.schedule.account_id === account.id &&
            it.scheduledDate >= asOfDate &&
            it.scheduledDate <= toDate,
        );
        let expectedDelta = 0;
        let lowDelta = 0;
        let highDelta = 0;
        let hasRange = false;
        for (const it of acctItems) {
          if (it.hasRange) hasRange = true;
          if (it.schedule.type === "income") {
            expectedDelta += it.expectedAmount;
            lowDelta += it.lowAmount;
            highDelta += it.highAmount;
          } else {
            expectedDelta -= it.expectedAmount;
            lowDelta -= it.highAmount;
            highDelta -= it.lowAmount;
          }
        }
        return {
          scheduledDelta: expectedDelta,
          projectedBalance: currentBalance + expectedDelta,
          lowBalance: currentBalance + lowDelta,
          highBalance: currentBalance + highDelta,
          hasRange,
          upcomingCount: acctItems.length,
        };
      };
      return {
        account,
        currentBalance,
        horizons: {
          30: calcForDays(30),
          60: calcForDays(60),
          90: calcForDays(90),
        },
      };
    },
  );

  const currentNetBalance = accountProjections.reduce(
    (s, p) => s + p.currentBalance,
    0,
  );
  const sumNetHorizon = (days: 30 | 60 | 90) => {
    const projectedNetBalance = accountProjections.reduce(
      (s, p) => s + p.horizons[days].projectedBalance,
      0,
    );
    const lowNetBalance = accountProjections.reduce(
      (s, p) => s + p.horizons[days].lowBalance,
      0,
    );
    const highNetBalance = accountProjections.reduce(
      (s, p) => s + p.horizons[days].highBalance,
      0,
    );
    const hasRange = accountProjections.some((p) => p.horizons[days].hasRange);
    return { projectedNetBalance, lowNetBalance, highNetBalance, hasRange };
  };

  let fixedExpense = 0;
  let variableExpense = 0;
  let totalIncome = 0;
  for (const s of schedules) {
    const profile = profiles[s.id];
    const mult = monthlyMultiplier(s.frequency);
    const monthlyAmt = Math.round(profile.expectedAmount * mult);
    if (s.type === "income") totalIncome += monthlyAmt;
    else if (s.amount_type === "fixed") fixedExpense += monthlyAmt;
    else variableExpense += monthlyAmt;
  }

  return {
    asOfDate,
    profiles,
    upcomingItems: items,
    horizons,
    accountProjections,
    totalsProjection: {
      currentNetBalance,
      horizons: {
        30: sumNetHorizon(30),
        60: sumNetHorizon(60),
        90: sumNetHorizon(90),
      },
    },
    monthlyCommitment: {
      fixedExpense,
      variableExpense,
      totalExpense: fixedExpense + variableExpense,
      totalIncome,
      annualizedExpense: (fixedExpense + variableExpense) * 12,
    },
  };
}
