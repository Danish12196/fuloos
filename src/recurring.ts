import {
  today,
  totals,
  validateTransaction,
  type Ledger,
  type OccurrenceMatchSource,
  type RecurringFrequency,
  type RecurringOccurrenceRecord,
  type RecurringSchedule,
  type Transaction,
} from "./domain.ts";

export const MIN_RECURRING_DATE = "1970-01-01";
export const MAX_RECURRING_DATE = "2100-12-31";
export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

export type SchedulePaymentStatus =
  | "overdue"
  | "due_today"
  | "upcoming"
  | "paid"
  | "paused"
  | "completed";

export interface ScheduleSummary {
  schedule: RecurringSchedule;
  paymentStatus: SchedulePaymentStatus;
  nextDueDate: string | null;
  overdueDates: string[];
  confirmedCount: number;
}

export interface OccurrenceItem {
  schedule: RecurringSchedule;
  date: string;
  status: "overdue" | "due_today" | "upcoming" | "paid";
  confirmation?: RecurringOccurrenceRecord;
  linkedTransaction?: Transaction;
}

export interface DashboardRecurringSummary {
  asOfDate: string;
  horizonDate: string;
  overdueCount: number;
  upcoming30Days: {
    items: OccurrenceItem[];
    income: number;
    expense: number;
  };
  monthly: {
    month: string;
    actual: { income: number; expense: number };
    confirmed: { income: number; expense: number };
    unconfirmed: { income: number; expense: number };
    estimated: { income: number; expense: number };
    projected: { income: number; expense: number };
  };
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(year, monthIndex, day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function daysInMonth(year: number, month: number): number {
  return utcDate(year, month, 0).getUTCDate();
}

export function parseIsoDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  )
    return null;
  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function formatIsoDate(
  year: number,
  month: number,
  day: number,
): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new Error("Choose a valid date.");
  const d = new Date(
    utcDate(parsed.year, parsed.month - 1, parsed.day).getTime() +
      days * 86_400_000,
  );
  return formatIsoDate(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
  );
}

export function daysBetween(start: string, end: string): number {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (!s || !e) throw new Error("Choose a valid date.");
  return Math.round(
    (utcDate(e.year, e.month - 1, e.day).getTime() -
      utcDate(s.year, s.month - 1, s.day).getTime()) /
      86_400_000,
  );
}

export function monthRange(month: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("Choose a valid month.");
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (y < 1 || m < 1 || m > 12) throw new Error("Choose a valid month.");
  return {
    start: formatIsoDate(y, m, 1),
    end: formatIsoDate(y, m, daysInMonth(y, m)),
  };
}

export function occurrenceAtStep(
  startDate: string,
  frequency: RecurringFrequency,
  step: number,
): string {
  const start = parseIsoDate(startDate);
  if (!start) throw new Error("Choose a valid start date.");
  if (!Number.isSafeInteger(step) || step < 0)
    throw new Error("Occurrence step must be a nonnegative integer.");
  if (frequency === "daily") return addDays(startDate, step);
  if (frequency === "weekly") return addDays(startDate, step * 7);
  if (frequency === "monthly" || frequency === "quarterly") {
    const monthsPerStep = frequency === "quarterly" ? 3 : 1;
    const totalMonths =
      start.year * 12 + (start.month - 1) + step * monthsPerStep;
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
    const targetDay = Math.min(
      start.day,
      daysInMonth(targetYear, targetMonth),
    );
    return formatIsoDate(targetYear, targetMonth, targetDay);
  }
  const targetYear = start.year + step;
  const targetDay = Math.min(
    start.day,
    daysInMonth(targetYear, start.month),
  );
  return formatIsoDate(targetYear, start.month, targetDay);
}

export function firstStepOnOrAfter(
  startDate: string,
  frequency: RecurringFrequency,
  targetDate: string,
): number {
  if (targetDate <= startDate) return 0;
  const s = parseIsoDate(startDate);
  const t = parseIsoDate(targetDate);
  if (!s || !t) throw new Error("Choose a valid date.");
  if (frequency === "daily") return daysBetween(startDate, targetDate);
  if (frequency === "weekly")
    return Math.ceil(daysBetween(startDate, targetDate) / 7);
  const monthsDiff = (t.year - s.year) * 12 + (t.month - s.month);
  let k =
    frequency === "monthly"
      ? Math.max(0, monthsDiff)
      : frequency === "quarterly"
        ? Math.max(0, Math.floor(monthsDiff / 3))
        : Math.max(0, t.year - s.year);
  while (k > 0 && occurrenceAtStep(startDate, frequency, k - 1) >= targetDate)
    k--;
  while (occurrenceAtStep(startDate, frequency, k) < targetDate) k++;
  return k;
}

export function isScheduledOccurrence(
  schedule: Pick<RecurringSchedule, "start_date" | "end_date" | "frequency">,
  date: string,
): boolean {
  if (!isValidIsoDate(date) || !isValidIsoDate(schedule.start_date))
    return false;
  if (date < schedule.start_date) return false;
  if (schedule.end_date && date > schedule.end_date) return false;
  const step = firstStepOnOrAfter(
    schedule.start_date,
    schedule.frequency,
    date,
  );
  return (
    occurrenceAtStep(schedule.start_date, schedule.frequency, step) === date
  );
}

export function generateOccurrences(
  schedule: Pick<RecurringSchedule, "start_date" | "end_date" | "frequency">,
  fromDate: string,
  toDate: string,
): string[] {
  if (
    !isValidIsoDate(schedule.start_date) ||
    !isValidIsoDate(fromDate) ||
    !isValidIsoDate(toDate)
  )
    throw new Error("Choose valid dates.");
  if (schedule.end_date && !isValidIsoDate(schedule.end_date))
    throw new Error("Choose a valid end date.");
  const effectiveFrom =
    fromDate > schedule.start_date ? fromDate : schedule.start_date;
  const effectiveTo =
    schedule.end_date && schedule.end_date < toDate
      ? schedule.end_date
      : toDate;
  if (effectiveTo < effectiveFrom) return [];
  const dates: string[] = [];
  let step = firstStepOnOrAfter(
    schedule.start_date,
    schedule.frequency,
    effectiveFrom,
  );
  for (;;) {
    const occ = occurrenceAtStep(schedule.start_date, schedule.frequency, step);
    if (occ > effectiveTo) break;
    dates.push(occ);
    step++;
  }
  return dates;
}

export function validateRecurringSchedule(
  s: Omit<RecurringSchedule, "id"> & { id?: string },
  ledger: Ledger,
): void {
  const name = s.name.trim();
  if (!name || name.length > 160)
    throw new Error("Enter a schedule name between 1 and 160 characters.");
  if (s.type !== "expense" && s.type !== "income")
    throw new Error("Recurring schedule must be an expense or income.");
  if (
    !Number.isSafeInteger(s.amount) ||
    s.amount < 0 ||
    s.amount > 100_000_000_000
  )
    throw new Error(
      "Amount must be zero or greater and within the supported limit.",
    );
  if (s.amount_type !== "fixed" && s.amount_type !== "variable")
    throw new Error("Choose fixed or variable amount.");
  if (!RECURRING_FREQUENCIES.includes(s.frequency))
    throw new Error("Choose a valid frequency.");
  if (s.status !== "active" && s.status !== "paused")
    throw new Error("Choose active or paused status.");
  if (!ledger.accounts.some((a) => a.id === s.account_id))
    throw new Error("Select an account.");
  if (s.category_id && !ledger.categories.some((c) => c.id === s.category_id))
    throw new Error("Choose an existing category.");
  if (
    !isValidIsoDate(s.start_date) ||
    s.start_date < MIN_RECURRING_DATE ||
    s.start_date > MAX_RECURRING_DATE
  )
    throw new Error(
      "Choose a valid start date between 1970-01-01 and 2100-12-31.",
    );
  if (s.end_date !== null) {
    if (!isValidIsoDate(s.end_date) || s.end_date > MAX_RECURRING_DATE)
      throw new Error(
        "Choose a valid end date on or before 2100-12-31.",
      );
    if (s.end_date < s.start_date)
      throw new Error("End date cannot be before start date.");
  }
  if (s.notes.length > 1000)
    throw new Error("Notes must be 1,000 characters or fewer.");
  if (s.id) {
    const confirmed = (ledger.recurring_occurrences ?? []).filter(
      (o) => o.recurring_id === s.id,
    );
    if (confirmed.length > 0) {
      const existing = (ledger.recurring ?? []).find((r) => r.id === s.id);
      if (existing && existing.type !== s.type)
        throw new Error(
          "Cannot change schedule type after occurrences have been confirmed.",
        );
      for (const occ of confirmed) {
        if (!isScheduledOccurrence(s, occ.occurrence_date))
          throw new Error(
            `Confirmed occurrence on ${occ.occurrence_date} would no longer match this schedule. Unlink it first or create a new schedule.`,
          );
      }
    }
  }
}

export function validateOccurrenceConfirmation(
  input: {
    id?: string;
    recurring_id: string;
    occurrence_date: string;
    transaction_id?: string;
    match_source?: OccurrenceMatchSource;
    match_reason?: string;
  },
  ledger: Ledger,
): void {
  const schedule = (ledger.recurring ?? []).find(
    (r) => r.id === input.recurring_id,
  );
  if (!schedule) throw new Error("Recurring schedule not found.");
  if (!isScheduledOccurrence(schedule, input.occurrence_date))
    throw new Error(
      "Occurrence date does not match this recurring schedule.",
    );
  if (
    input.match_source !== undefined &&
    input.match_source !== "manual" &&
    input.match_source !== "auto"
  )
    throw new Error("Invalid occurrence match source.");
  if (input.match_reason !== undefined && input.match_reason.length > 300)
    throw new Error("Match reason must be 300 characters or fewer.");
  const occurrences = ledger.recurring_occurrences ?? [];
  if (
    occurrences.some(
      (o) =>
        o.id !== input.id &&
        o.recurring_id === input.recurring_id &&
        o.occurrence_date === input.occurrence_date,
    )
  )
    throw new Error("This occurrence has already been confirmed.");
  if (input.transaction_id !== undefined) {
    const tx = ledger.transactions.find((t) => t.id === input.transaction_id);
    if (!tx) throw new Error("Select an existing transaction to link.");
    if (tx.type !== schedule.type)
      throw new Error(
        "Linked transaction type must match the recurring schedule type.",
      );
    if (
      occurrences.some(
        (o) => o.id !== input.id && o.transaction_id === input.transaction_id,
      )
    )
      throw new Error(
        "That transaction is already linked to a recurring occurrence.",
      );
  }
}

export function buildConfirmTransaction(
  schedule: RecurringSchedule,
  occurrenceDate: string,
  ledger: Ledger,
  overrides?: {
    amount?: number;
    date?: string;
    account_id?: string;
    category_id?: string | null;
    payee?: string;
    notes?: string;
  },
): Omit<Transaction, "id"> {
  validateOccurrenceConfirmation(
    { recurring_id: schedule.id, occurrence_date: occurrenceDate },
    ledger,
  );
  if (schedule.amount_type === "variable" && overrides?.amount === undefined)
    throw new Error("Enter the actual amount paid for this variable payment.");
  const account_id = overrides?.account_id ?? schedule.account_id;
  const date = overrides?.date ?? occurrenceDate;
  const tx: Omit<Transaction, "id"> = {
    type: schedule.type,
    amount: overrides?.amount ?? schedule.amount,
    account_id,
    to_account_id: null,
    category_id:
      overrides?.category_id !== undefined
        ? overrides.category_id
        : schedule.category_id,
    date,
    payee: overrides?.payee ?? schedule.name,
    notes: overrides?.notes ?? schedule.notes,
  };
  validateTransaction(tx, ledger);
  return tx;
}

function firstUnconfirmedFrom(
  schedule: RecurringSchedule,
  confirmedDates: Set<string>,
  minDate: string,
): string | null {
  const from = minDate > schedule.start_date ? minDate : schedule.start_date;
  if (schedule.end_date && schedule.end_date < from) return null;
  let step = firstStepOnOrAfter(
    schedule.start_date,
    schedule.frequency,
    from,
  );
  for (;;) {
    const occ = occurrenceAtStep(schedule.start_date, schedule.frequency, step);
    if (schedule.end_date && occ > schedule.end_date) return null;
    if (!confirmedDates.has(occ)) return occ;
    step++;
  }
}

const UPCOMING_LEAD_DAYS: Record<RecurringFrequency, number> = {
  daily: 1,
  weekly: 2,
  monthly: 7,
  quarterly: 14,
  yearly: 30,
};

export function describeScheduleStatus(
  schedule: RecurringSchedule,
  ledger: Ledger,
  asOfDate: string = today(),
): ScheduleSummary {
  const links = (ledger.recurring_occurrences ?? []).filter(
    (o) => o.recurring_id === schedule.id,
  );
  const confirmedDates = new Set(links.map((o) => o.occurrence_date));
  if (schedule.status === "paused") {
    return {
      schedule,
      paymentStatus: "paused",
      nextDueDate: firstUnconfirmedFrom(schedule, confirmedDates, asOfDate),
      overdueDates: [],
      confirmedCount: confirmedDates.size,
    };
  }
  const yesterday = addDays(asOfDate, -1);
  const overdueDates =
    yesterday >= schedule.start_date
      ? generateOccurrences(schedule, schedule.start_date, yesterday).filter(
          (d) => !confirmedDates.has(d),
        )
      : [];
  const nextDueDate = firstUnconfirmedFrom(
    schedule,
    confirmedDates,
    schedule.start_date,
  );
  let paymentStatus: SchedulePaymentStatus;
  if (nextDueDate === null) paymentStatus = "completed";
  else if (nextDueDate < asOfDate) paymentStatus = "overdue";
  else if (nextDueDate === asOfDate) paymentStatus = "due_today";
  else {
    const hasConfirmedOnOrAfterToday = [...confirmedDates].some(
      (d) => d >= asOfDate,
    );
    const nextStep = firstStepOnOrAfter(
      schedule.start_date,
      schedule.frequency,
      nextDueDate,
    );
    const hasConfirmedPreviousCycle =
      nextStep > 0 &&
      confirmedDates.has(
        occurrenceAtStep(schedule.start_date, schedule.frequency, nextStep - 1),
      );
    const daysUntilNext = daysBetween(asOfDate, nextDueDate);
    if (
      hasConfirmedOnOrAfterToday &&
      (schedule.frequency === "daily" ||
        daysUntilNext > UPCOMING_LEAD_DAYS[schedule.frequency])
    ) {
      paymentStatus = "paid";
    } else if (
      hasConfirmedPreviousCycle &&
      daysUntilNext > UPCOMING_LEAD_DAYS[schedule.frequency]
    ) {
      paymentStatus = "paid";
    } else {
      paymentStatus = "upcoming";
    }
  }
  return {
    schedule,
    paymentStatus,
    nextDueDate,
    overdueDates,
    confirmedCount: confirmedDates.size,
  };
}

export function listOccurrences(
  ledger: Ledger,
  fromDate: string,
  toDate: string,
  options: {
    asOfDate?: string;
    includeConfirmed?: boolean;
    includeOverdueBeforeFrom?: boolean;
    includePaused?: boolean;
  } = {},
): OccurrenceItem[] {
  const asOfDate = options.asOfDate ?? today();
  const schedules = (ledger.recurring ?? []).filter(
    (r) => options.includePaused || r.status === "active",
  );
  const occurrences = ledger.recurring_occurrences ?? [];
  const txById = new Map(ledger.transactions.map((t) => [t.id, t]));
  const linkByKey = new Map(
    occurrences.map((o) => [`${o.recurring_id}:${o.occurrence_date}`, o]),
  );
  const items: OccurrenceItem[] = [];
  for (const schedule of schedules) {
    const start =
      options.includeOverdueBeforeFrom &&
      schedule.status === "active" &&
      schedule.start_date < fromDate
        ? schedule.start_date
        : fromDate;
    const dates = generateOccurrences(schedule, start, toDate);
    for (const date of dates) {
      const confirmation = linkByKey.get(`${schedule.id}:${date}`);
      if (date < fromDate && (confirmation || date >= asOfDate)) continue;
      if (confirmation && !options.includeConfirmed) continue;
      const status: OccurrenceItem["status"] = confirmation
        ? "paid"
        : date < asOfDate
          ? "overdue"
          : date === asOfDate
            ? "due_today"
            : "upcoming";
      items.push({
        schedule,
        date,
        status,
        confirmation,
        linkedTransaction: confirmation
          ? txById.get(confirmation.transaction_id)
          : undefined,
      });
    }
  }
  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.schedule.name.localeCompare(b.schedule.name) ||
      a.schedule.id.localeCompare(b.schedule.id),
  );
}

export function dashboardRecurringSummary(
  ledger: Ledger,
  asOfDate: string = today(),
  month: string = asOfDate.slice(0, 7),
): DashboardRecurringSummary {
  const horizonDate = addDays(asOfDate, 30);
  const upcomingItems = listOccurrences(ledger, asOfDate, horizonDate, {
    asOfDate,
    includeConfirmed: false,
    includePaused: false,
  });
  let upcomingIncome = 0;
  let upcomingExpense = 0;
  for (const item of upcomingItems) {
    if (item.schedule.type === "income") upcomingIncome += item.schedule.amount;
    else upcomingExpense += item.schedule.amount;
  }

  let overdueCount = 0;
  for (const schedule of ledger.recurring ?? []) {
    if (schedule.status === "active")
      overdueCount += describeScheduleStatus(
        schedule,
        ledger,
        asOfDate,
      ).overdueDates.length;
  }

  const { start, end } = monthRange(month);
  const actual = totals(
    ledger.transactions.filter((t) => t.date >= start && t.date <= end),
  );
  const monthItems = listOccurrences(ledger, start, end, {
    asOfDate,
    includeConfirmed: true,
    includePaused: false,
  });
  const confirmed = { income: 0, expense: 0 };
  const unconfirmed = { income: 0, expense: 0 };
  for (const item of monthItems) {
    if (item.confirmation) {
      const amt = item.linkedTransaction
        ? item.linkedTransaction.amount
        : item.schedule.amount;
      if (item.schedule.type === "income") confirmed.income += amt;
      else confirmed.expense += amt;
    } else {
      if (item.schedule.type === "income")
        unconfirmed.income += item.schedule.amount;
      else unconfirmed.expense += item.schedule.amount;
    }
  }

  return {
    asOfDate,
    horizonDate,
    overdueCount,
    upcoming30Days: {
      items: upcomingItems,
      income: upcomingIncome,
      expense: upcomingExpense,
    },
    monthly: {
      month,
      actual,
      confirmed,
      unconfirmed,
      estimated: {
        income: confirmed.income + unconfirmed.income,
        expense: confirmed.expense + unconfirmed.expense,
      },
      projected: {
        income: actual.income + unconfirmed.income,
        expense: actual.expense + unconfirmed.expense,
      },
    },
  };
}
