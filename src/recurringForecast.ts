import {
  balance,
  today,
  type Account,
  type Ledger,
  type RecurringFrequency,
  type RecurringOccurrenceRecord,
  type RecurringSchedule,
  type Transaction,
} from "./domain.ts";
import {
  addDays,
  daysBetween,
  firstStepOnOrAfter,
  generateOccurrences,
  occurrenceAtStep,
} from "./recurring.ts";
import { medianOf } from "./recurringSeries.ts";

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
  precomputed?: {
    txById: Map<string, Transaction>;
    occsBySchedule: Map<string, RecurringOccurrenceRecord[]>;
  },
): ScheduleHistoryProfile {
  const txById =
    precomputed?.txById ??
    new Map(ledger.transactions.map((t) => [t.id, t]));
  const rawLinks = precomputed
    ? (precomputed.occsBySchedule.get(schedule.id) ?? [])
    : (ledger.recurring_occurrences ?? []).filter(
        (o) => o.recurring_id === schedule.id,
      );
  const links = rawLinks
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
    sampleCount >= 2 ? Math.round(medianOf(recent.map((s) => s.offsetDays))) : 0;

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
  const occsBySchedule = new Map<string, RecurringOccurrenceRecord[]>();
  for (const occ of occurrences) {
    const list = occsBySchedule.get(occ.recurring_id);
    if (list) list.push(occ);
    else occsBySchedule.set(occ.recurring_id, [occ]);
  }
  const precomputed = { txById, occsBySchedule };

  const profiles: Record<string, ScheduleHistoryProfile> = {};
  for (const s of schedules) {
    profiles[s.id] = analyzeScheduleHistory(s, ledger, precomputed);
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

