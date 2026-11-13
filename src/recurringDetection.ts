import {
  defaultRecurringPreferences,
  today,
  type Ledger,
  type RecurringAmountType,
  type RecurringKind,
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
import {
  buildPatternKey,
  defaultDeterministicClassifier,
  inferCategoryHint,
  merchantSimilarity,
  normalizeMerchant,
  predominantValue,
  scheduleAliases,
  transactionLabel,
  type DetectableFrequency,
  type NormalizedMerchant,
  type PatternClassifier,
  type RecurringCategoryHint,
} from "./recurringMerchant.ts";

export const MAX_DETECTION_TRANSACTIONS = 5000;
export const DETECTION_BATCH_SIZE = 500;

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
