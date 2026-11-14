import {
  addDaysIso,
  isIsoCalendarDate,
  today,
  type GoalContribution,
  type GoalKind,
  type GoalStatus,
  type Ledger,
  type SavingsGoal,
} from "./domain.ts";

export type GoalHealthStatus =
  | "on_track"
  | "behind"
  | "completed"
  | "no_target_date";

export interface GoalProgress {
  goal: SavingsGoal;
  effectiveAmount: number;
  remainingFils: number;
  progressPercent: number;
  monthlyNeeded: number | null;
  monthlyPace: number;
  projectedDate: string | null;
  healthStatus: GoalHealthStatus;
  contributions: GoalContribution[];
}

export interface GoalsSummary {
  totalTarget: number;
  totalSaved: number;
  activeCount: number;
  completedCount: number;
  pausedCount: number;
  overallPercent: number;
}

const MAX_AMOUNT_FILS = 100_000_000_000;
const DAYS_PER_MONTH = 30.4375;
const MAX_PROJECTION_DAYS = 36500;

function daysBetweenIso(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(`${fromIso}T12:00:00Z`);
  const toMs = Date.parse(`${toIso}T12:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.round((toMs - fromMs) / 86_400_000);
}

/** Percentage of target achieved (0..100, rounded to 1 decimal place). */
export function goalProgressPercent(
  currentAmount: number,
  targetAmount: number,
): number {
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return 0;
  const safeCurrent = Math.max(0, currentAmount);
  return Math.min(
    100,
    Math.max(0, Math.round((safeCurrent / targetAmount) * 1000) / 10),
  );
}

/** Remaining fils needed to reach target_amount (never negative). */
export function goalRemainingFils(
  currentAmount: number,
  targetAmount: number,
): number {
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return 0;
  return Math.max(0, targetAmount - Math.max(0, currentAmount));
}

/**
 * Monthly contribution in integer fils required from `todayIso` to hit `goal.target_date`.
 * Returns `null` when `target_date` is null, or `0` when already funded.
 */
export function monthlyContributionNeeded(
  goal: Pick<SavingsGoal, "target_amount" | "current_amount" | "target_date">,
  todayIso: string = today(),
): number | null {
  if (!goal.target_date || !isIsoCalendarDate(goal.target_date)) return null;
  const remaining = goalRemainingFils(goal.current_amount, goal.target_amount);
  if (remaining === 0) return 0;
  const days = daysBetweenIso(todayIso, goal.target_date);
  if (days <= 0) return remaining;
  const months = Math.max(1, Math.ceil(days / DAYS_PER_MONTH));
  return Math.ceil(remaining / months);
}

/**
 * Estimates the current monthly net contribution pace (in integer fils/month)
 * over the trailing `windowDays` (default 90 days) up to `todayIso`.
 */
export function estimateMonthlyPace(
  contributions: readonly GoalContribution[],
  todayIso: string = today(),
  windowDays = 90,
): number {
  if (!contributions.length || windowDays <= 0) return 0;
  const windowStart = addDaysIso(todayIso, -windowDays);
  let net = 0;
  let earliestInWindow: string | null = null;
  for (const c of contributions) {
    if (c.date < windowStart || c.date > todayIso) continue;
    net += c.amount;
    if (!earliestInWindow || c.date < earliestInWindow) {
      earliestInWindow = c.date;
    }
  }
  if (net <= 0 || !earliestInWindow) return 0;
  // Use at least a 30-day denominator so a single recent deposit doesn't inflate pace.
  const observedDays = Math.max(
    30,
    Math.min(windowDays, daysBetweenIso(earliestInWindow, todayIso) + 1),
  );
  const months = observedDays / DAYS_PER_MONTH;
  return Math.round(net / months);
}

/**
 * Projects the completion date (YYYY-MM-DD) based on recent contribution pace
 * plus optional linked recurring monthly contribution (in integer fils/month).
 * Returns `todayIso` if already funded, or `null` if pace <= 0 or > 100 years.
 */
export function projectedCompletionDate(
  goal: Pick<SavingsGoal, "target_amount" | "current_amount">,
  contributions: readonly GoalContribution[],
  todayIso: string = today(),
  monthlyRecurringFils = 0,
): string | null {
  const remaining = goalRemainingFils(goal.current_amount, goal.target_amount);
  if (remaining === 0) return todayIso;
  const pace =
    estimateMonthlyPace(contributions, todayIso) +
    Math.max(0, Math.round(monthlyRecurringFils));
  if (pace <= 0) return null;
  const daysNeeded = Math.ceil((remaining / pace) * DAYS_PER_MONTH);
  if (daysNeeded > MAX_PROJECTION_DAYS) return null;
  return addDaysIso(todayIso, daysNeeded);
}

export function computeGoalHealthStatus(
  goal: Pick<SavingsGoal, "target_amount" | "current_amount" | "target_date" | "status">,
  contributions: readonly GoalContribution[],
  todayIso: string = today(),
  monthlyRecurringFils = 0,
): GoalHealthStatus {
  if (
    goal.status === "completed" ||
    goal.current_amount >= goal.target_amount
  ) {
    return "completed";
  }
  if (!goal.target_date) return "no_target_date";
  if (goal.target_date < todayIso) return "behind";
  const projected = projectedCompletionDate(
    goal,
    contributions,
    todayIso,
    monthlyRecurringFils,
  );
  if (!projected) return "behind";
  return projected <= goal.target_date ? "on_track" : "behind";
}

export function computeGoalProgress(
  goal: SavingsGoal,
  allContributions: readonly GoalContribution[],
  todayIso: string = today(),
  monthlyRecurringFils = 0,
): GoalProgress {
  const contributions = allContributions
    .filter((c) => c.goal_id === goal.id)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  const effectiveAmount = Math.max(0, goal.current_amount);
  const remainingFils = goalRemainingFils(effectiveAmount, goal.target_amount);
  const progressPercent = goalProgressPercent(
    effectiveAmount,
    goal.target_amount,
  );
  const monthlyNeeded = monthlyContributionNeeded(goal, todayIso);
  const monthlyPace =
    estimateMonthlyPace(contributions, todayIso) +
    Math.max(0, Math.round(monthlyRecurringFils));
  const projectedDate = projectedCompletionDate(
    goal,
    contributions,
    todayIso,
    monthlyRecurringFils,
  );
  const healthStatus = computeGoalHealthStatus(
    goal,
    contributions,
    todayIso,
    monthlyRecurringFils,
  );
  return {
    goal,
    effectiveAmount,
    remainingFils,
    progressPercent,
    monthlyNeeded,
    monthlyPace,
    projectedDate,
    healthStatus,
    contributions,
  };
}

export function summarizeGoals(goals: readonly SavingsGoal[]): GoalsSummary {
  let totalTarget = 0;
  let totalSaved = 0;
  let activeCount = 0;
  let completedCount = 0;
  let pausedCount = 0;

  for (const g of goals) {
    if (g.status === "paused") {
      pausedCount++;
      continue;
    }
    if (g.status === "completed" || g.current_amount >= g.target_amount) {
      completedCount++;
    } else {
      activeCount++;
    }
    totalTarget += Math.max(0, g.target_amount);
    totalSaved += Math.max(0, Math.min(g.current_amount, g.target_amount));
  }

  return {
    totalTarget,
    totalSaved,
    activeCount,
    completedCount,
    pausedCount,
    overallPercent: goalProgressPercent(totalSaved, totalTarget),
  };
}

export function applyContributionAmount(
  currentAmount: number,
  deltaAmount: number,
): number {
  return Math.max(0, Math.min(MAX_AMOUNT_FILS, currentAmount + deltaAmount));
}

const VALID_KINDS: readonly GoalKind[] = ["savings", "sinking_fund"];
const VALID_STATUSES: readonly GoalStatus[] = ["active", "completed", "paused"];

export function validateSavingsGoal(
  goal: Omit<SavingsGoal, "id"> & { id?: string },
  ledger?: Pick<Ledger, "accounts">,
): void {
  const name = goal.name.trim();
  if (!name || name.length > 80) {
    throw new Error("Goal name must be between 1 and 80 characters.");
  }
  if (
    !Number.isSafeInteger(goal.target_amount) ||
    goal.target_amount <= 0 ||
    goal.target_amount > MAX_AMOUNT_FILS
  ) {
    throw new Error("Target amount must be greater than zero.");
  }
  if (
    !Number.isSafeInteger(goal.current_amount) ||
    goal.current_amount < 0 ||
    goal.current_amount > MAX_AMOUNT_FILS
  ) {
    throw new Error("Current saved amount must be zero or greater.");
  }
  if (goal.target_date !== null) {
    if (
      !isIsoCalendarDate(goal.target_date) ||
      goal.target_date < "1970-01-01" ||
      goal.target_date > "2100-12-31"
    ) {
      throw new Error("Choose a valid target date.");
    }
  }
  if (!VALID_KINDS.includes(goal.kind)) {
    throw new Error("Choose a valid goal type.");
  }
  if (!VALID_STATUSES.includes(goal.status)) {
    throw new Error("Choose a valid goal status.");
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(goal.color)) {
    throw new Error("Choose a valid goal color.");
  }
  if (
    goal.account_id &&
    ledger &&
    !ledger.accounts.some((a) => a.id === goal.account_id)
  ) {
    throw new Error("Choose an existing linked account.");
  }
  if (goal.notes && goal.notes.length > 500) {
    throw new Error("Notes must be 500 characters or fewer.");
  }
}

export function validateGoalContribution(
  contribution: Omit<GoalContribution, "id"> & { id?: string },
  ledger?: Pick<Ledger, "goals" | "transactions">,
): void {
  if (!contribution.goal_id) {
    throw new Error("Select a goal.");
  }
  if (
    ledger?.goals &&
    !ledger.goals.some((g) => g.id === contribution.goal_id)
  ) {
    throw new Error("Choose an existing goal.");
  }
  if (
    !Number.isSafeInteger(contribution.amount) ||
    contribution.amount === 0 ||
    Math.abs(contribution.amount) > MAX_AMOUNT_FILS
  ) {
    throw new Error("Contribution amount must be non-zero.");
  }
  if (
    !isIsoCalendarDate(contribution.date) ||
    contribution.date < "1970-01-01" ||
    contribution.date > "2100-12-31"
  ) {
    throw new Error("Choose a valid contribution date.");
  }
  if (
    contribution.transaction_id &&
    ledger?.transactions &&
    !ledger.transactions.some((t) => t.id === contribution.transaction_id)
  ) {
    throw new Error("Linked transaction does not exist.");
  }
  if (contribution.notes && contribution.notes.length > 500) {
    throw new Error("Notes must be 500 characters or fewer.");
  }
}
