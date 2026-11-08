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
import {
  AMOUNT_BAND,
  CADENCE_RULES,
  amountInBand,
  buildChains,
  chainMedianAmount,
  chainStats,
  cyclesForGap,
  daysBetween as fastDaysBetween,
  joinChains,
  medianOf,
  seriesHasEnded,
  textSimilarity,
  textTokens,
  type SeriesChain,
} from "./recurringSeries.ts";

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
  | "loan"
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
  /** Sample payee/notes text from the payments, used for hints such as "subscription". */
  descriptionText?: string;
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
  /** "ended" when payments stopped; accepting it records the series as history. */
  status: "active" | "ended";
  firstDate: string;
  lastDate: string;
  /** Other merchant names the same series was billed under. */
  aliases: string[];
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
  "subscription",
  "subscriptions",
  "membership",
  "monthly",
  "yearly",
  "annual",
  "renewal",
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
    match: (_j, t) => t.includes("anthropic") || (t.includes("claude") && t.includes("ai")),
    key: "anthropic",
    displayName: "Anthropic / Claude",
    hint: "subscription",
  },
  {
    match: (_j, t) => t.includes("patreon"),
    key: "patreon",
    displayName: "Patreon",
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

/** Services that bill on a subscription, used to label detected series. */
const SUBSCRIPTION_BRANDS =
  /\b(patreon|anthropic|claude|openai|chatgpt|github|notion|adobe|microsoft|xbox|playstation|nintendo|disney|osn|shahid|starzplay|audible|kindle|duolingo|linkedin|canva|dropbox|proton|nordvpn|expressvpn|midjourney|perplexity|youtube|twitch|crunchyroll|hbo|paramount|deezer|tidal|substack|medium|godaddy|namecheap|vercel|cloudflare|digitalocean|icloud|onedrive|mubi)\b/;

export function inferCategoryHint(
  merchant: NormalizedMerchant,
  type: RecurringKind,
  categoryName: string,
  descriptionText = "",
): RecurringCategoryHint {
  if (merchant.canonicalHint) return merchant.canonicalHint;
  const text = `${merchant.key} ${categoryName.toLowerCase()} ${descriptionText.toLowerCase()}`;
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
  if (/\b(install?ments?|loan|emi|financing|mortgage)\b/.test(text)) return "loan";
  if (SUBSCRIPTION_BRANDS.test(text)) return "subscription";
  if (/\b(gym|fitness)\b/.test(text)) return "membership";
  if (
    /\b(subscriptions?|membership|monthly|plus|premium|pro|cloud|stream|streaming|music|video|software|saas|patreon)\b/.test(
      text,
    )
  )
    return "subscription";
  if (/\bclub\b/.test(text)) return "membership";
  return type === "income" ? "salary" : "other_recurring";
}

export const defaultDeterministicClassifier: PatternClassifier = {
  classify(f: PatternFeatures): PatternClassification {
    // Bills paid by hand drift by days or weeks; subscriptions barely move.
    const driftTolerance = {
      weekly: { mean: 1.5, max: 2 },
      monthly: { mean: 10, max: 16 },
      quarterly: { mean: 12, max: 25 },
      yearly: { mean: 15, max: 35 },
    }[f.frequency];
    const intervalScore = Math.max(
      0,
      1 -
        Math.min(1, f.meanResidualDays / driftTolerance.mean) * 0.6 -
        Math.min(1, f.maxResidualDays / driftTolerance.max) * 0.15,
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
      f.descriptionText,
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

/** Text that identifies who a transaction was with: the payee, or the notes when there is no payee. */
export function transactionLabel(tx: Pick<Transaction, "payee" | "notes">): string {
  return tx.payee.trim() || tx.notes.trim();
}

const SERIES_ORDER: DetectableFrequency[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

/** Fewest payments needed before a series is suggested. */
const MIN_SERIES_PAYMENTS: Record<DetectableFrequency, { active: number; ended: number }> = {
  weekly: { active: 4, ended: 6 },
  monthly: { active: 3, ended: 4 },
  quarterly: { active: 3, ended: 3 },
  yearly: { active: 2, ended: 3 },
};

/** Fewest days a series must span. */
const MIN_SERIES_SPAN: Record<DetectableFrequency, number> = {
  weekly: 11,
  monthly: 48,
  quarterly: 155,
  yearly: 340,
};

interface DetectionGroup {
  type: RecurringKind;
  merchant: NormalizedMerchant;
  txs: Transaction[];
}

interface CandidateSeries {
  frequency: DetectableFrequency;
  chain: SeriesChain<Transaction>;
  groups: DetectionGroup[];
}

function sameDayOfCycle(a: string, b: string, frequency: DetectableFrequency): boolean {
  if (frequency === "weekly") return true;
  const pa = parseIsoDate(a);
  const pb = parseIsoDate(b);
  if (!pa || !pb) return false;
  const diff = Math.abs(pa.day - pb.day);
  return Math.min(diff, 31 - diff) <= 4;
}

/**
 * Two chains from different merchant names are one subscription that was
 * renamed on the statement (for example a creator's page later billed as the
 * platform's generic "membership") when the second starts one cycle after the
 * first stops, on the same day of the month, for the same amount.
 */
function isContinuation(
  a: CandidateSeries,
  b: CandidateSeries,
): boolean {
  if (a.frequency !== b.frequency) return false;
  const lastA = a.chain.members[a.chain.members.length - 1].item;
  const firstB = b.chain.members[0].item;
  if (firstB.date <= lastA.date) return false;
  const gap = fastDaysBetween(lastA.date, firstB.date);
  const cycles = cyclesForGap(gap, a.frequency);
  if (cycles < 1 || cycles > 2) return false;
  const sameMerchant = a.groups.some((g) => b.groups.includes(g));
  if (sameMerchant) {
    // A price change or pay rise: the next cycle continues at a new amount
    // with the same description.
    if (cycles !== 1) return false;
    if (!amountInBand(firstB.amount, lastA.amount)) return false;
    return (
      textSimilarity(
        textTokens(`${lastA.payee} ${lastA.notes}`),
        textTokens(`${firstB.payee} ${firstB.notes}`),
      ) >= 0.5
    );
  }
  // Different names: only join steady amounts (a subscription price) that
  // match closely, with a few payments on each side.
  if (a.chain.members.length < 3 || b.chain.members.length < 2) return false;
  const tailA = a.chain.members.slice(-3).map((m) => m.item.amount);
  const headB = b.chain.members.slice(0, 3).map((m) => m.item.amount);
  const steady = (xs: number[]) =>
    Math.max(...xs) - Math.min(...xs) <= Math.max(...xs) * 0.02;
  if (!steady(tailA) || !steady(headB)) return false;
  const medA = medianOf(tailA);
  const medB = medianOf(headB);
  if (medA <= 0 || medB <= 0) return false;
  if (Math.abs(medA - medB) / Math.max(medA, medB) > 0.02) return false;
  return sameDayOfCycle(lastA.date, firstB.date, a.frequency);
}

function descriptionText(txs: Transaction[]): string {
  return txs
    .slice(-3)
    .map((t) => `${t.payee} ${t.notes}`)
    .join(" ");
}

/**
 * True when the merchant or description says this is a bill, subscription,
 * loan, salary or similar, rather than everyday spending.
 */
function hasRecurringSignal(
  groupMerchant: NormalizedMerchant,
  merchants: NormalizedMerchant[],
  categoryName: string,
  text: string,
): boolean {
  if (groupMerchant.canonicalHint && groupMerchant.canonicalHint !== "other_recurring") return true;
  if (merchants.some((m) => m.canonicalHint && m.canonicalHint !== "other_recurring")) return true;
  if (/\b(salary|payroll|wage|stipend|pension)\b/i.test(`${text} ${categoryName}`)) return true;
  return (
    inferCategoryHint(
      { key: groupMerchant.key, displayName: "", tokens: groupMerchant.tokens },
      "expense",
      categoryName,
      text,
    ) !== "other_recurring"
  );
}

function seriesKeySuffix(amount: number): string {
  if (amount <= 0) return "0";
  return String(Math.round(Math.log(amount) / Math.log(AMOUNT_BAND)));
}

function scheduleAliases(schedule: RecurringSchedule): string[] {
  const aliases = [schedule.name];
  for (const m of schedule.notes.matchAll(/"([^"]{1,80})"/g)) aliases.push(m[1]);
  return aliases;
}

/**
 * Analyzes historical ledger transactions to discover weekly, monthly,
 * quarterly and yearly recurring expenses and income.
 *
 * Payments are grouped by merchant (payee, or the notes when the payee is
 * empty), then split into drift-tolerant series: each series is a chain of
 * payments roughly one cycle apart with amounts in a band, so a bill paid on
 * a different day each month still counts, and two bills from the same
 * provider stay separate. Series that stopped are reported with status
 * "ended" so they can be kept as history.
 */
export function detectRecurringPatterns(
  ledger: Ledger,
  options: {
    asOfDate?: string;
    classifier?: PatternClassifier;
    minConfidence?: number;
    /** Include series that have stopped (default true). */
    includeEnded?: boolean;
  } = {},
): DetectedPattern[] {
  const prefs: RecurringPreferences =
    ledger.recurring_prefs ?? defaultRecurringPreferences;
  if (prefs.auto_detect === "off") return [];

  const asOfDate = options.asOfDate ?? today();
  const classifier = options.classifier ?? defaultDeterministicClassifier;
  const minConfidence = options.minConfidence ?? 0.55;
  const includeEnded = options.includeEnded ?? true;
  const dismissed = new Set(prefs.dismissed_keys);
  const linkedTxIds = new Set(
    (ledger.recurring_occurrences ?? []).map((o) => o.transaction_id),
  );

  // Latest date each account has data for. A series only counts as ended
  // when its account has newer transactions, so an account whose statement
  // has not been imported lately does not make everything look cancelled.
  const accountHorizon = new Map<string, string>();
  for (const t of ledger.transactions) {
    if (t.date > asOfDate) continue;
    const cur = accountHorizon.get(t.account_id);
    if (!cur || t.date > cur) accountHorizon.set(t.account_id, t.date);
  }

  const sortedCandidates = ledger.transactions
    .filter(
      (t) =>
        (t.type === "expense" || t.type === "income") &&
        !linkedTxIds.has(t.id) &&
        t.date <= asOfDate &&
        t.amount > 0 &&
        transactionLabel(t).length > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .slice(-MAX_DETECTION_TRANSACTIONS);

  const groups: DetectionGroup[] = [];
  const groupByKey = new Map<string, DetectionGroup>();
  const groupsByToken = new Map<string, DetectionGroup[]>();
  const groupOfTx = new Map<string, DetectionGroup>();
  for (
    let offset = 0;
    offset < sortedCandidates.length;
    offset += DETECTION_BATCH_SIZE
  ) {
    const batch = sortedCandidates.slice(offset, offset + DETECTION_BATCH_SIZE);
    for (const tx of batch) {
      const type = tx.type as RecurringKind;
      const norm = normalizeMerchant(transactionLabel(tx));
      if (!norm.key) continue;
      let target = groupByKey.get(`${type}:${norm.key}`);
      if (!target) {
        // Only merchants sharing a word (or a 4-letter prefix) can be similar.
        const seen = new Set<DetectionGroup>();
        for (const tok of norm.tokens) {
          for (const g of groupsByToken.get(`${type}:${tok.slice(0, 4)}`) ?? []) {
            if (seen.has(g)) continue;
            seen.add(g);
            if (merchantSimilarity(g.merchant, norm) >= 0.85) {
              target = g;
              break;
            }
          }
          if (target) break;
        }
        if (target) groupByKey.set(`${type}:${norm.key}`, target);
      }
      if (!target) {
        target = { type, merchant: norm, txs: [] };
        groups.push(target);
        groupByKey.set(`${type}:${norm.key}`, target);
        for (const tok of norm.tokens) {
          const k = `${type}:${tok.slice(0, 4)}`;
          const list = groupsByToken.get(k) ?? [];
          list.push(target);
          groupsByToken.set(k, list);
        }
      }
      target.txs.push(tx);
      groupOfTx.set(tx.id, target);
    }
  }

  const existingSchedules = ledger.recurring ?? [];
  const categoryNameFor = (txs: Transaction[]): string => {
    const ids = txs
      .map((t) => t.category_id)
      .filter((c): c is string => c !== null);
    if (!ids.length) return "";
    const id = predominantValue(ids).value;
    return ledger.categories.find((c) => c.id === id)?.name ?? "";
  };
  const consumed = new Set<string>();
  const results: DetectedPattern[] = [];
  const usedKeys = new Set<string>();

  for (const frequency of SERIES_ORDER) {
    // 1. Build chains per merchant from payments no earlier cadence claimed.
    let candidates: CandidateSeries[] = [];
    for (const group of groups) {
      const free = group.txs.filter((t) => !consumed.has(t.id));
      if (free.length < 2) continue;
      for (const chain of buildChains(free, frequency, (t) => `${t.payee} ${t.notes}`)) {
        candidates.push({ frequency, chain, groups: [group] });
      }
    }

    // 2. Join renamed subscriptions and price changes into one series.
    if (frequency !== "weekly") {
      let joinable = candidates
        .filter((c) => c.chain.members.length >= 2)
        .sort((a, b) =>
          a.chain.members[0].item.date.localeCompare(b.chain.members[0].item.date),
        );
      const removed = new Set<CandidateSeries>();
      let merged = true;
      while (merged) {
        merged = false;
        for (const a of joinable) {
          if (removed.has(a)) continue;
          const lastDate = a.chain.members[a.chain.members.length - 1].item.date;
          for (const b of joinable) {
            if (a === b || removed.has(b)) continue;
            const firstB = b.chain.members[0].item.date;
            if (firstB <= lastDate) continue;
            if (fastDaysBetween(lastDate, firstB) > CADENCE_RULES[frequency].periodDays * 2.5) {
              continue;
            }
            if (a.groups[0].type !== b.groups[0].type) continue;
            if (
              b.groups.some((g) => a.groups.includes(g)) &&
              a.groups.length + b.groups.length > 2
            ) {
              continue;
            }
            if (!isContinuation(a, b)) continue;
            a.chain = joinChains(a.chain, b.chain);
            a.groups = [...new Set([...a.groups, ...b.groups])];
            removed.add(b);
            merged = true;
            break;
          }
        }
        joinable = joinable.filter((c) => !removed.has(c));
      }
      candidates = candidates.filter((c) => !removed.has(c));
    }

    const minima = MIN_SERIES_PAYMENTS[frequency];
    const viable = candidates.filter(
      (c) => c.chain.members.length >= Math.min(minima.active, minima.ended),
    );
    const viableTxIds = new Set(
      viable.flatMap((c) => c.chain.members.map((m) => m.item.id)),
    );

    // 3. Score each chain and turn the good ones into suggestions.
    for (const cand of viable) {
      const { chain } = cand;
      const stats = chainStats(chain);
      const memberTxs = chain.members.map((m) => m.item);
      const memberIds = new Set(memberTxs.map((t) => t.id));
      const type = cand.groups[0].type;
      // Name the series after how its recent payments were labelled, so a
      // merchant with several series ("Car - Loan", "Car - Fuel") keeps
      // them apart, and a renamed subscription shows its current name.
      const memberMerchants = memberTxs.map((t) => normalizeMerchant(transactionLabel(t)));
      const recentKeys = memberMerchants.slice(-6).map((m) => m.key);
      const { value: nameKey } = predominantValue(recentKeys);
      const merchant =
        [...memberMerchants].reverse().find((m) => m.key === nameKey) ??
        cand.groups[0].merchant;

      if (fastDaysBetween(stats.firstDate, stats.lastDate) < MIN_SERIES_SPAN[frequency]) continue;

      const { value: accountId, share: accountConsistency } = predominantValue(
        memberTxs.map((t) => t.account_id),
      );
      const lastAccount = memberTxs[memberTxs.length - 1].account_id;
      const horizon = accountHorizon.get(lastAccount) ?? asOfDate;
      const ended = seriesHasEnded(stats.lastDate, frequency, horizon < asOfDate ? horizon : asOfDate);
      const needed = ended ? minima.ended : minima.active;
      if (stats.count < needed) continue;

      const knownRecurring = hasRecurringSignal(
        cand.groups[0].merchant,
        memberMerchants,
        categoryNameFor(memberTxs),
        descriptionText(memberTxs),
      );
      // Bills paid by hand are sometimes late enough to look like a skipped
      // month, so known bills tolerate more gaps.
      const maxMissedShare = knownRecurring ? 0.5 : 0.34;
      if (stats.missedCycles > Math.floor(stats.count * maxMissedShare)) continue;

      // Other payments to the same merchant, in the same amount band, while
      // the series ran. Lots of them means this is ordinary repeat shopping.
      // A known subscription merchant may run several series side by side
      // (two plans, or one for a family member), so payments that form their
      // own series do not count against it.
      const medianAmount = chainMedianAmount(chain, chain.members.length);
      let competing = 0;
      for (const g of cand.groups) {
        for (const t of g.txs) {
          if (memberIds.has(t.id) || t.date < stats.firstDate || t.date > stats.lastDate) continue;
          if (knownRecurring && viableTxIds.has(t.id)) continue;
          if (amountInBand(t.amount, medianAmount)) competing++;
        }
      }
      if (competing > Math.max(1, Math.floor(stats.count * 0.35))) continue;

      const amounts = memberTxs.map((t) => t.amount);
      const minAmount = Math.min(...amounts);
      const maxAmount = Math.max(...amounts);
      if (stats.amountCv > 0.45) continue;
      if (frequency === "yearly" && stats.count === 2 && stats.amountCv > 0.12) continue;
      // Short series of varying amounts and dates are too easy to hit by chance.
      if (stats.count <= 4 && stats.amountCv > 0.2 && stats.meanDriftDays > CADENCE_RULES[frequency].toleranceDays / 3) continue;
      // Without a steady amount, only accept bills and other known recurring
      // kinds, or very regular monthly payments. This keeps a favourite
      // restaurant or shop that happens to be visited monthly out.
      const repeatedAmountShare = predominantValue(
        memberTxs.map((t) => String(t.amount)),
      ).share;
      const steadyAmount = stats.amountCv <= 0.02 || repeatedAmountShare >= 0.6;
      if (!steadyAmount && !knownRecurring) {
        if (frequency !== "monthly" || stats.meanDriftDays > 2.5 || stats.count < 6) continue;
      }
      // Weekly, quarterly and yearly series of a generic merchant need a
      // steady amount and date.
      if (!knownRecurring && frequency !== "monthly") {
        const maxDrift = frequency === "weekly" ? 1 : frequency === "quarterly" ? 7 : 10;
        if (!steadyAmount || stats.meanDriftDays > maxDrift) continue;
        if (frequency === "quarterly" && stats.count < 4) continue;
      }

      const recentAmounts = amounts.slice(-6);
      const isExactFixed = recentAmounts.every((a) => a === recentAmounts[0]);
      const recentMean =
        recentAmounts.reduce((s, v) => s + v, 0) / recentAmounts.length;
      const isNearFixed =
        !isExactFixed &&
        recentMean > 0 &&
        (Math.max(...recentAmounts) - Math.min(...recentAmounts)) / recentMean <= 0.025;
      const amountType: RecurringAmountType =
        isExactFixed || isNearFixed ? "fixed" : "variable";
      let weightedSum = 0;
      let weightTotal = 0;
      recentAmounts.forEach((amt, idx) => {
        weightedSum += amt * (idx + 1);
        weightTotal += idx + 1;
      });
      const estimatedAmount =
        amountType === "fixed"
          ? amounts[amounts.length - 1]
          : Math.round(weightedSum / weightTotal);

      const nonNullCategories = memberTxs
        .map((t) => t.category_id)
        .filter((c): c is string => c !== null);
      const categoryId = nonNullCategories.length
        ? predominantValue(nonNullCategories).value
        : null;
      const categoryName =
        ledger.categories.find((c) => c.id === categoryId)?.name ?? "";
      const sampleText = descriptionText(memberTxs);

      const classification = classifier.classify({
        merchant,
        type,
        frequency,
        observationCount: stats.count,
        missedCycles: stats.missedCycles,
        offCycleCount: competing,
        meanResidualDays: stats.meanDriftDays,
        maxResidualDays: stats.maxDriftDays,
        amountMean: stats.amountMean,
        amountStdDev: stats.amountStd,
        amountCv: stats.amountCv,
        isExactFixed: amountType === "fixed",
        accountConsistency,
        categoryName,
        descriptionText: sampleText,
      });
      if (classification.confidence < minConfidence) continue;

      // Aliases: other merchant names this series was billed under.
      const aliasNames: string[] = [];
      for (const m of memberMerchants) {
        if (
          m.key !== merchant.key &&
          merchantSimilarity(m, merchant) < 0.85 &&
          !aliasNames.includes(m.displayName)
        ) {
          aliasNames.push(m.displayName);
        }
      }

      // Skip if an existing schedule already covers this series.
      const alreadyScheduled = existingSchedules.some(
        (s) =>
          s.type === type &&
          s.frequency === frequency &&
          (s.amount === 0 || amountInBand(s.amount, medianAmount)) &&
          scheduleAliases(s).some(
            (name) =>
              merchantSimilarity(name, merchant) >= 0.78 ||
              memberMerchants.some((m) => merchantSimilarity(name, m) >= 0.78),
          ),
      );
      if (alreadyScheduled) continue;

      const baseKey = buildPatternKey(type, merchant.key, frequency);
      let patternKey = ended
        ? `${baseKey}:ended:${stats.lastDate.slice(0, 7)}`
        : baseKey;
      if (usedKeys.has(patternKey)) {
        patternKey = `${patternKey}:${seriesKeySuffix(medianAmount)}`;
      }
      if (usedKeys.has(patternKey) || dismissed.has(patternKey)) continue;

      // The schedule covers the latest unbroken run of payments, so accepting
      // it links them without flagging old skipped cycles as overdue.
      let runStart = chain.members.length - 1;
      while (
        runStart > 0 &&
        chain.members[runStart].step - chain.members[runStart - 1].step === 1
      ) {
        runStart--;
      }
      let run = chain.members.slice(runStart);
      const runDays = run.map((m) => parseIsoDate(m.item.date)?.day ?? 1);
      let anchorDay = medianOf(runDays);
      // Keep an established month-end billing day even when the latest run
      // is short or starts in a short month.
      const allDays = chain.members.map((m) => parseIsoDate(m.item.date)?.day ?? 1);
      const fullAnchor = medianOf(allDays);
      if (frequency !== "weekly" && fullAnchor >= 29 && fullAnchor > anchorDay) {
        anchorDay = fullAnchor;
      }
      let scheduleStartDate = run[0].item.date;
      let runBaseStep = run[0].step;
      if (frequency !== "weekly") {
        const first = parseIsoDate(run[0].item.date)!;
        const candidatesForStart = [-1, 0, 1].map((shift) => {
          const total = first.year * 12 + (first.month - 1) + shift;
          const y = Math.floor(total / 12);
          const mo = (total % 12) + 1;
          return formatIsoDate(y, mo, Math.min(anchorDay, daysInMonth(y, mo)));
        });
        scheduleStartDate = candidatesForStart.reduce((best, d) =>
          Math.abs(daysBetween(d, run[0].item.date)) <
          Math.abs(daysBetween(best, run[0].item.date))
            ? d
            : best,
        );
        // A start date clamped to a short month (Feb 28 for the 31st) would
        // pull every later due date back, so start at the first cycle whose
        // month holds the anchor day. Payments before it stay unlinked.
        const parsedStart = parseIsoDate(scheduleStartDate)!;
        if (parsedStart.day < anchorDay) {
          const monthsPerStep =
            frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
          for (let k = 1; k <= 12; k++) {
            const total =
              parsedStart.year * 12 + (parsedStart.month - 1) + k * monthsPerStep;
            const y = Math.floor(total / 12);
            const mo = (total % 12) + 1;
            if (daysInMonth(y, mo) < anchorDay) continue;
            const remaining = run.filter((m) => m.step - run[0].step >= k);
            if (!remaining.length && ended) break;
            scheduleStartDate = formatIsoDate(y, mo, anchorDay);
            runBaseStep = run[0].step + k;
            run = remaining;
            break;
          }
        }
      }
      const historicalLinks = run.map((m) => ({
        occurrence_date: occurrenceAtStep(
          scheduleStartDate,
          frequency,
          m.step - runBaseStep,
        ),
        transaction_id: m.item.id,
      }));
      const lastOccurrence = historicalLinks.length
        ? historicalLinks[historicalLinks.length - 1].occurrence_date
        : scheduleStartDate;
      const lastStep = run.length ? run[run.length - 1].step - runBaseStep : -1;
      const nextStepDate = occurrenceAtStep(scheduleStartDate, frequency, lastStep + 1);
      const nextExpectedDate =
        ended || nextStepDate >= asOfDate
          ? nextStepDate
          : occurrenceAtStep(
              scheduleStartDate,
              frequency,
              firstStepOnOrAfter(scheduleStartDate, frequency, asOfDate),
            );

      const noun = type === "income" ? "deposits" : "payments";
      const explanationParts = [
        `${stats.count} ${frequency} ${noun}`,
        amountType === "fixed" ? "consistent amount" : "variable amount",
      ];
      if (stats.meanDriftDays <= 1.5) explanationParts.push("steady billing date");
      else explanationParts.push(`date varies by about ${Math.round(stats.meanDriftDays)}d`);
      if (stats.missedCycles > 0) {
        explanationParts.push(
          `${stats.missedCycles} skipped cycle${stats.missedCycles > 1 ? "s" : ""}`,
        );
      }
      if (aliasNames.length) explanationParts.push(`also billed as ${aliasNames.join(", ")}`);
      if (ended) explanationParts.push(`last paid ${stats.lastDate}`);

      const notesParts = [`Detected from ${stats.count} historical transactions`];
      if (aliasNames.length) {
        notesParts.push(`also billed as ${aliasNames.map((n) => `"${n}"`).join(", ")}`);
      }

      usedKeys.add(patternKey);
      for (const t of memberTxs) consumed.add(t.id);

      results.push({
        patternKey,
        merchantKey: merchant.key,
        displayName: merchant.displayName,
        type,
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
        status: ended ? "ended" : "active",
        firstDate: stats.firstDate,
        lastDate: stats.lastDate,
        aliases: aliasNames,
        explanation: explanationParts.join(" · "),
        supportingTransactions: memberTxs
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date)),
        draftSchedule: {
          name: merchant.displayName,
          type,
          amount: estimatedAmount,
          amount_type: amountType,
          account_id: accountId,
          category_id: categoryId,
          frequency,
          start_date: scheduleStartDate,
          end_date: ended ? lastOccurrence : null,
          status: "active",
          notes: notesParts.join(" · "),
        },
        historicalLinks,
      });
    }
  }

  // Ended series are filtered only here, after they have claimed their
  // payments, so leaving them out never turns those payments into other
  // (wrong) suggestions.
  return results
    .filter((p) => includeEnded || p.status === "active")
    .sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) ||
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
  monthly: { earlyDays: 12, lateDays: 16 },
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
      if (transactionLabel(linked)) {
        const norm = normalizeMerchant(transactionLabel(linked));
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

        const txMerchant = normalizeMerchant(transactionLabel(tx));
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
    // Ended schedules are history, not an ongoing commitment.
    if (s.end_date && s.end_date < asOfDate) continue;
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
