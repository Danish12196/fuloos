import {
  defaultRecurringPreferences,
  today,
  type AutoMatchSetting,
  type Ledger,
  type RecurringFrequency,
  type RecurringSchedule,
  type Transaction,
} from "./domain.ts";
import {
  addDays,
  daysBetween,
  generateOccurrences,
} from "./recurring.ts";
import {
  buildMatchDismissKey,
  merchantSimilarity,
  normalizeMerchant,
  scheduleAliases,
  transactionLabel,
  type NormalizedMerchant,
} from "./recurringMerchant.ts";

export const AUTO_LINK_THRESHOLD = 0.88;
export const REVIEW_MATCH_THRESHOLD = 0.58;
export const AMBIGUITY_MARGIN = 0.12;

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
    });
  }

  const txMerchantById = new Map<string, NormalizedMerchant>();
  for (const tx of unlinkedTxs) {
    txMerchantById.set(tx.id, normalizeMerchant(transactionLabel(tx)));
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

        const txMerchant = txMerchantById.get(tx.id)!;
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
