import type {
  RecurringFrequency,
  RecurringKind,
  RecurringSchedule,
  Transaction,
} from "./domain.ts";

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
    .replace(/\be&/g, "eand")
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


export function predominantValue<T extends string | null>(values: T[]): {
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

export function scheduleAliases(schedule: RecurringSchedule): string[] {
  const aliases = [schedule.name];
  for (const m of schedule.notes.matchAll(/"([^"]{1,80})"/g)) aliases.push(m[1]);
  return aliases;
}
