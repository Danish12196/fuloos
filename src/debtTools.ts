import {
  accountDelta,
  addDaysIso,
  shiftMonth,
  type Account,
  type Transaction,
} from "./domain.ts";

export interface StatementWindow {
  start: string;
  end: string;
}

export interface CardSummary {
  debtFils: number;
  creditLimitFils: number;
  availableCreditFils: number;
  utilizationPct: number;
  statementWindow: StatementWindow;
  statementBalanceFils: number;
  nextDueDate: string | null;
  daysUntilDue: number | null;
}

export type PayoffStrategy = "avalanche" | "snowball";

export interface DebtInput {
  id: string;
  name: string;
  balanceFils: number;
  aprBps: number;
  minimumPaymentFils: number;
  source?: "credit_card" | "liability";
}

export interface PayoffEvent {
  id: string;
  name: string;
  month: number;
}

export interface ScheduleMonthPoint {
  month: number;
  totalBalanceFils: number;
  interestFils: number;
  paidFils: number;
}

export interface DebtPayoffResult {
  strategy: PayoffStrategy;
  months: number;
  totalInterestFils: number;
  totalPaidFils: number;
  remainingDebtFils: number;
  paidOff: boolean;
  payoffOrder: PayoffEvent[];
  schedulePreview: ScheduleMonthPoint[];
}

function daysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

function clampDayDate(ym: string, day: number): string {
  const [y, m] = ym.split("-").map(Number);
  const clamped = Math.max(1, Math.min(day, daysInMonth(y, m)));
  return `${ym}-${String(clamped).padStart(2, "0")}`;
}

function isValidDayOfMonth(day: number | undefined): day is number {
  return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 31;
}

export function computeCardSummary(
  account: Account,
  balanceFils: number,
  transactions: Transaction[],
  todayIso: string,
): CardSummary {
  const debtFils = balanceFils < 0 ? Math.trunc(-balanceFils) : 0;
  const creditLimitFils =
    typeof account.credit_limit === "number" && account.credit_limit > 0
      ? Math.trunc(account.credit_limit)
      : 0;
  const availableCreditFils =
    creditLimitFils > 0 ? Math.max(0, creditLimitFils - debtFils) : 0;
  const utilizationPct =
    creditLimitFils > 0
      ? Math.round((debtFils / creditLimitFils) * 1000) / 10
      : 0;

  const todayMonth = todayIso.slice(0, 7);
  let start: string;
  let end: string;
  if (isValidDayOfMonth(account.statement_day)) {
    const cycleEndThisMonth = clampDayDate(todayMonth, account.statement_day);
    if (todayIso <= cycleEndThisMonth) {
      const prevMonth = shiftMonth(todayMonth, -1);
      const prevCycleEnd = clampDayDate(prevMonth, account.statement_day);
      start = addDaysIso(prevCycleEnd, 1);
      end = cycleEndThisMonth;
    } else {
      const nextMonth = shiftMonth(todayMonth, 1);
      const nextCycleEnd = clampDayDate(nextMonth, account.statement_day);
      start = addDaysIso(cycleEndThisMonth, 1);
      end = nextCycleEnd;
    }
  } else {
    const [y, m] = todayMonth.split("-").map(Number);
    start = `${todayMonth}-01`;
    end = `${todayMonth}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  }

  let netDeltaInWindow = 0;
  for (const t of transactions) {
    if (t.date < start || t.date > end) continue;
    if (t.account_id !== account.id && t.to_account_id !== account.id) continue;
    netDeltaInWindow += accountDelta(t, account.id);
  }
  const statementBalanceFils =
    netDeltaInWindow < 0 ? Math.trunc(-netDeltaInWindow) : 0;

  let nextDueDate: string | null = null;
  let daysUntilDue: number | null = null;
  if (isValidDayOfMonth(account.payment_due_day)) {
    const dueThisMonth = clampDayDate(todayMonth, account.payment_due_day);
    nextDueDate =
      dueThisMonth >= todayIso
        ? dueThisMonth
        : clampDayDate(shiftMonth(todayMonth, 1), account.payment_due_day);
    const msPerDay = 86_400_000;
    daysUntilDue = Math.round(
      (Date.parse(nextDueDate + "T12:00:00Z") -
        Date.parse(todayIso + "T12:00:00Z")) /
        msPerDay,
    );
  }

  return {
    debtFils,
    creditLimitFils,
    availableCreditFils,
    utilizationPct,
    statementWindow: { start, end },
    statementBalanceFils,
    nextDueDate,
    daysUntilDue,
  };
}

export function simulateDebtPayoff(
  debts: DebtInput[],
  extraMonthlyFils: number,
  strategy: PayoffStrategy,
  maxMonths = 360,
): DebtPayoffResult {
  const extra = Math.max(0, Math.trunc(extraMonthlyFils || 0));
  const cap = Math.max(1, Math.trunc(maxMonths || 360));

  const active = debts
    .filter((d) => Number.isFinite(d.balanceFils) && d.balanceFils > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      balance: Math.trunc(d.balanceFils),
      aprBps: Math.max(0, Math.trunc(d.aprBps || 0)),
      minPay: Math.max(0, Math.trunc(d.minimumPaymentFils || 0)),
      paidOff: false,
    }));

  if (active.length === 0) {
    return {
      strategy,
      months: 0,
      totalInterestFils: 0,
      totalPaidFils: 0,
      remainingDebtFils: 0,
      paidOff: true,
      payoffOrder: [],
      schedulePreview: [],
    };
  }

  const initialTotalMinimums = active.reduce((sum, d) => sum + d.minPay, 0);
  let totalInterestFils = 0;
  let totalPaidFils = 0;
  let months = 0;
  const payoffOrder: PayoffEvent[] = [];
  const schedulePreview: ScheduleMonthPoint[] = [];

  for (let month = 1; month <= cap; month++) {
    let monthInterest = 0;
    let monthPaid = 0;

    for (const d of active) {
      if (d.balance <= 0) continue;
      const interest = Math.round(d.balance * (d.aprBps / 120000));
      d.balance += interest;
      monthInterest += interest;
      totalInterestFils += interest;
    }

    for (const d of active) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, d.minPay);
      d.balance -= pay;
      monthPaid += pay;
      totalPaidFils += pay;
    }

    let pool = Math.max(0, initialTotalMinimums + extra - monthPaid);
    const targets = active
      .filter((d) => d.balance > 0)
      .sort((a, b) =>
        strategy === "avalanche"
          ? b.aprBps - a.aprBps || a.balance - b.balance
          : a.balance - b.balance || b.aprBps - a.aprBps,
      );

    for (const d of targets) {
      if (pool <= 0) break;
      const extraPay = Math.min(d.balance, pool);
      d.balance -= extraPay;
      pool -= extraPay;
      monthPaid += extraPay;
      totalPaidFils += extraPay;
    }

    for (const d of active) {
      if (!d.paidOff && d.balance === 0) {
        d.paidOff = true;
        payoffOrder.push({ id: d.id, name: d.name, month });
      }
    }

    const totalBalanceFils = active.reduce((sum, d) => sum + d.balance, 0);
    schedulePreview.push({
      month,
      totalBalanceFils,
      interestFils: monthInterest,
      paidFils: monthPaid,
    });
    months = month;

    if (totalBalanceFils === 0) {
      break;
    }
  }

  const remainingDebtFils = active.reduce((sum, d) => sum + d.balance, 0);
  return {
    strategy,
    months,
    totalInterestFils,
    totalPaidFils,
    remainingDebtFils,
    paidOff: remainingDebtFils === 0,
    payoffOrder,
    schedulePreview,
  };
}
