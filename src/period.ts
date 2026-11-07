// Period selection shared by every page that looks at a span of months.
// A period is a span ending at an anchor month ("YYYY-MM"). A custom span
// also carries its first month (`from`).
import { shiftMonth } from "./domain.ts";

export type PeriodSpan = "month" | "custom" | "ytd" | "12" | "all";

export const PERIOD_SPANS: {
  value: PeriodSpan;
  short: string;
  long: string;
}[] = [
  { value: "month", short: "Month", long: "Month" },
  { value: "custom", short: "Custom", long: "Pick a start and end month" },
  { value: "ytd", short: "YTD", long: "Year to date" },
  { value: "12", short: "12M", long: "12 months" },
  { value: "all", short: "All", long: "All time" },
];

export const isPeriodSpan = (v: string): v is PeriodSpan =>
  PERIOD_SPANS.some((s) => s.value === v);

/** First and last month (inclusive) covered, or null for all time. */
export function periodMonths(
  span: PeriodSpan,
  month: string,
  from?: string,
): { first: string; last: string } | null {
  if (span === "all") return null;
  if (span === "ytd") return { first: `${month.slice(0, 4)}-01`, last: month };
  if (span === "custom")
    return { first: from && from < month ? from : month, last: month };
  const length = span === "month" ? 1 : Number(span);
  return { first: shiftMonth(month, 1 - length), last: month };
}

/** Number of months between two "YYYY-MM" values, counting both ends. */
export function monthsBetween(first: string, last: string): number {
  return (
    (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
    Number(last.slice(5, 7)) -
    Number(first.slice(5, 7)) +
    1
  );
}

/** How far the arrows move: one whole period, so pages never overlap. */
export function periodStep(
  span: PeriodSpan,
  month = "",
  from?: string,
): number {
  if (span === "all") return 0;
  if (span === "month") return 1;
  if (span === "ytd") return 12;
  if (span === "custom") {
    const range = periodMonths(span, month, from);
    return range ? monthsBetween(range.first, range.last) : 1;
  }
  return Number(span);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const shortMonthName = (m: number) => MONTHS[m];

const parts = (month: string) => ({
  year: month.slice(0, 4),
  index: Number(month.slice(5, 7)) - 1,
});

/** Human label: "November 2026", "Sep – Nov 2026", "Dec 2025 – Nov 2026". */
export function periodLabel(
  span: PeriodSpan,
  month: string,
  from?: string,
): string {
  const range = periodMonths(span, month, from);
  if (!range) return "All time";
  const a = parts(range.first),
    b = parts(range.last);
  if (range.first === range.last) return `${LONG_MONTHS[b.index]} ${b.year}`;
  if (a.year === b.year)
    return `${MONTHS[a.index]} – ${MONTHS[b.index]} ${b.year}`;
  return `${MONTHS[a.index]} ${a.year} – ${MONTHS[b.index]} ${b.year}`;
}

/** Exact dates, e.g. "1 Sep – 30 Nov 2026". */
export function periodDates(
  span: PeriodSpan,
  month: string,
  from?: string,
): string {
  const range = periodMonths(span, month, from);
  if (!range) return "Every transaction";
  const a = parts(range.first),
    b = parts(range.last);
  const lastDay = new Date(
    Date.UTC(Number(b.year), b.index + 1, 0),
  ).getUTCDate();
  const start =
    a.year === b.year
      ? `1 ${MONTHS[a.index]}`
      : `1 ${MONTHS[a.index]} ${a.year}`;
  return `${start} – ${lastDay} ${MONTHS[b.index]} ${b.year}`;
}

/** Whether a month falls inside the period (all time contains everything). */
export function periodContains(
  span: PeriodSpan,
  anchor: string,
  month: string,
  from?: string,
): boolean {
  const range = periodMonths(span, anchor, from);
  return !range || (month >= range.first && month <= range.last);
}
