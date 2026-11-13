import { daysBetween as slowDaysBetween } from "./recurring.ts";

const dayIndexCache = new Map<string, number>();

/** Days since 1970-01-01 for a valid YYYY-MM-DD date (memoised; detection compares dates a lot). */
function dayIndex(date: string): number {
  let v = dayIndexCache.get(date);
  if (v === undefined) {
    v = slowDaysBetween("1970-01-01", date);
    if (dayIndexCache.size > 20000) dayIndexCache.clear();
    dayIndexCache.set(date, v);
  }
  return v;
}

/** Whole days from `start` to `end`. */
export function daysBetween(start: string, end: string): number {
  return dayIndex(end) - dayIndex(start);
}

/**
 * Drift-tolerant series extraction used by recurring detection.
 *
 * Real bills rarely land on the same day each month: a phone bill can be paid
 * on the 2nd one month and the 17th the next. Instead of snapping payments to
 * a fixed anchor day, a series is built as a chain of payments whose gaps are
 * close to a whole number of cycles and whose amounts stay in a band around
 * the chain's recent median. One merchant can hold several chains (a phone
 * bill and a home internet bill from the same provider), and chains that end
 * are kept so the caller can show them as past recurring payments.
 */

export type SeriesFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export interface SeriesItem {
  id: string;
  date: string;
  amount: number;
  /** Optional description (payee and notes); similar text keeps a series together. */
  text?: string;
}

export interface SeriesMember<T extends SeriesItem> {
  item: T;
  /** Cycle index from the first member; gaps of more than one cycle are skipped cycles. */
  step: number;
}

export interface SeriesChain<T extends SeriesItem> {
  frequency: SeriesFrequency;
  members: SeriesMember<T>[];
}

export interface CadenceRule {
  periodDays: number;
  /** Allowed distance (days) between a gap and a whole number of cycles. */
  toleranceDays: number;
  /** Largest number of cycles a single gap may span (1 = no skipped cycle). */
  maxCyclesPerGap: number;
}

export const CADENCE_RULES: Record<SeriesFrequency, CadenceRule> = {
  weekly: { periodDays: 7, toleranceDays: 2, maxCyclesPerGap: 2 },
  monthly: { periodDays: 30.44, toleranceDays: 16, maxCyclesPerGap: 3 },
  quarterly: { periodDays: 91.31, toleranceDays: 25, maxCyclesPerGap: 2 },
  yearly: { periodDays: 365.25, toleranceDays: 35, maxCyclesPerGap: 2 },
};

/** Amounts within this factor of the chain's recent median can join it. */
export const AMOUNT_BAND = 1.5;

/**
 * Returns how many cycles a gap of `gapDays` spans, or 0 when it does not fit
 * the cadence.
 */
export function cyclesForGap(
  gapDays: number,
  frequency: SeriesFrequency,
): number {
  const rule = CADENCE_RULES[frequency];
  let best = 0;
  let bestDeviation = Infinity;
  for (let n = 1; n <= rule.maxCyclesPerGap; n++) {
    const deviation = Math.abs(gapDays - n * rule.periodDays);
    // Skipped cycles get a little more slack, since drift compounds.
    const tolerance = rule.toleranceDays + (n - 1) * rule.toleranceDays * 0.25;
    if (deviation <= tolerance && deviation < bestDeviation) {
      best = n;
      bestDeviation = deviation;
    }
  }
  // A gap must be at least half a cycle so two payments in the same cycle
  // never chain together.
  if (best && gapDays < rule.periodDays * 0.45) return 0;
  return best;
}

export function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function chainMedianAmount<T extends SeriesItem>(
  chain: SeriesChain<T>,
  recent = 6,
): number {
  return medianOf(chain.members.slice(-recent).map((m) => m.item.amount));
}

export function amountInBand(amount: number, reference: number): boolean {
  if (reference <= 0 || amount <= 0) return amount === reference;
  const ratio = amount / reference;
  return ratio <= AMOUNT_BAND && ratio >= 1 / AMOUNT_BAND;
}

const MONTH_WORDS = new Set([
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
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

/** Words of a description, ignoring numbers, dates and month names. */
export function textTokens(text: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const tok of text.toLowerCase().split(/[^a-z]+/)) {
    if (tok.length < 2 || MONTH_WORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

export function textSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0.5;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

interface FitResult {
  cycles: number;
  cost: number;
}

function fitToChain<T extends SeriesItem>(
  chain: SeriesChain<T>,
  item: T,
  tokens: Map<string, Set<string>>,
  median: number,
): FitResult | null {
  const rule = CADENCE_RULES[chain.frequency];
  const last = chain.members[chain.members.length - 1];
  const gap = daysBetween(last.item.date, item.date);
  const cycles = cyclesForGap(gap, chain.frequency);
  if (!cycles) return null;
  if (!amountInBand(item.amount, median)) return null;
  const dateCost =
    Math.abs(gap - cycles * rule.periodDays) / rule.toleranceDays;
  const amountCost =
    median > 0 && item.amount > 0
      ? Math.abs(Math.log(item.amount / median)) / Math.log(AMOUNT_BAND)
      : 0;
  const textCost =
    (1 - textSimilarity(tokens.get(item.id)!, tokens.get(last.item.id)!)) * 0.8;
  return {
    cycles,
    cost: dateCost + amountCost + textCost + (cycles - 1) * 0.6,
  };
}

/**
 * Splits a merchant's payments into chains for one cadence. Items are
 * assigned greedily in date order to the chain whose next expected payment
 * fits best (closest gap, closest amount, most similar description, fewest
 * skipped cycles). A payment is not given to a chain when a payment a few
 * days later fits that chain clearly better, so an extra purchase from a
 * subscription merchant does not hijack the subscription.
 */
export function buildChains<T extends SeriesItem>(
  items: T[],
  frequency: SeriesFrequency,
  textOf: (item: T) => string | undefined = (item) => item.text,
): SeriesChain<T>[] {
  const rule = CADENCE_RULES[frequency];
  const maxGap = rule.maxCyclesPerGap * rule.periodDays + rule.toleranceDays;
  const sorted = [...items].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const tokens = new Map(sorted.map((it) => [it.id, textTokens(textOf(it))]));
  const chains: SeriesChain<T>[] = [];
  const chainMedians = new Map<SeriesChain<T>, number>();
  for (let index = 0; index < sorted.length; index++) {
    const item = sorted[index];
    let bestChain: SeriesChain<T> | null = null;
    let bestCycles = 0;
    let bestCost = Infinity;
    for (const chain of chains) {
      const lastDate = chain.members[chain.members.length - 1].item.date;
      if (daysBetween(lastDate, item.date) > maxGap) continue;
      const median = chainMedians.get(chain)!;
      const fit = fitToChain(chain, item, tokens, median);
      if (!fit) continue;
      let betterLater = false;
      for (let j = index + 1; j < sorted.length; j++) {
        const later = sorted[j];
        if (daysBetween(item.date, later.date) > rule.toleranceDays) break;
        const laterFit = fitToChain(chain, later, tokens, median);
        if (laterFit && laterFit.cost + 0.15 < fit.cost) {
          betterLater = true;
          break;
        }
      }
      if (betterLater) continue;
      if (fit.cost < bestCost) {
        bestCost = fit.cost;
        bestChain = chain;
        bestCycles = fit.cycles;
      }
    }
    if (bestChain) {
      const last = bestChain.members[bestChain.members.length - 1];
      bestChain.members.push({ item, step: last.step + bestCycles });
      chainMedians.set(bestChain, chainMedianAmount(bestChain));
    } else {
      const next: SeriesChain<T> = { frequency, members: [{ item, step: 0 }] };
      chains.push(next);
      chainMedians.set(next, item.amount);
    }
  }
  return chains;
}

/**
 * Joins chain `b` onto the end of chain `a` (b must start after a ends),
 * keeping cycle numbering continuous.
 */
export function joinChains<T extends SeriesItem>(
  a: SeriesChain<T>,
  b: SeriesChain<T>,
): SeriesChain<T> {
  const lastA = a.members[a.members.length - 1];
  const gap = daysBetween(lastA.item.date, b.members[0].item.date);
  const cycles = Math.max(1, cyclesForGap(gap, a.frequency));
  const offset = lastA.step + cycles - b.members[0].step;
  return {
    frequency: a.frequency,
    members: [
      ...a.members,
      ...b.members.map((m) => ({ item: m.item, step: m.step + offset })),
    ],
  };
}

export interface ChainStats {
  count: number;
  firstDate: string;
  lastDate: string;
  missedCycles: number;
  /** Mean distance (days) of each gap from a whole number of cycles. */
  meanDriftDays: number;
  maxDriftDays: number;
  amountMean: number;
  amountStd: number;
  amountCv: number;
}

export function chainStats<T extends SeriesItem>(
  chain: SeriesChain<T>,
): ChainStats {
  const rule = CADENCE_RULES[chain.frequency];
  const m = chain.members;
  const drifts: number[] = [];
  for (let i = 1; i < m.length; i++) {
    const gap = daysBetween(m[i - 1].item.date, m[i].item.date);
    const cycles = m[i].step - m[i - 1].step;
    drifts.push(Math.abs(gap - cycles * rule.periodDays));
  }
  const amounts = m.map((x) => x.item.amount);
  const mean = amounts.reduce((s, v) => s + v, 0) / (amounts.length || 1);
  const variance =
    amounts.length > 1
      ? amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length
      : 0;
  const std = Math.sqrt(variance);
  return {
    count: m.length,
    firstDate: m[0].item.date,
    lastDate: m[m.length - 1].item.date,
    missedCycles: m[m.length - 1].step - m[0].step + 1 - m.length,
    meanDriftDays: drifts.length
      ? drifts.reduce((s, v) => s + v, 0) / drifts.length
      : 0,
    maxDriftDays: drifts.length ? Math.max(...drifts) : 0,
    amountMean: mean,
    amountStd: std,
    amountCv: mean > 0 ? std / mean : 0,
  };
}

/**
 * A series has ended when the next payment is clearly overdue relative to
 * `horizonDate` (the latest date we have data for).
 */
export function seriesHasEnded(
  lastDate: string,
  frequency: SeriesFrequency,
  horizonDate: string,
): boolean {
  const rule = CADENCE_RULES[frequency];
  const grace =
    frequency === "yearly"
      ? rule.periodDays + 60
      : rule.periodDays * 1.5 + rule.toleranceDays;
  return daysBetween(lastDate, horizonDate) > grace;
}
