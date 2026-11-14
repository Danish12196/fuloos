import assert from "node:assert/strict";
import test from "node:test";
import { demoLedger } from "../src/demo.ts";
import type { GoalContribution, Ledger, SavingsGoal } from "../src/domain.ts";
import {
  applyContributionAmount,
  computeGoalHealthStatus,
  computeGoalProgress,
  estimateMonthlyPace,
  goalProgressPercent,
  goalRemainingFils,
  monthlyContributionNeeded,
  projectedCompletionDate,
  summarizeGoals,
  validateGoalContribution,
  validateSavingsGoal,
} from "../src/goals.ts";

function makeGoal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "g1",
    name: "Emergency Fund",
    target_amount: 1_200_000, // 12,000 AED
    current_amount: 300_000, // 3,000 AED
    target_date: "2026-12-31",
    account_id: null,
    color: "#1d5b48",
    emoji: "🛟",
    kind: "savings",
    status: "active",
    notes: "",
    ...overrides,
  };
}

function makeContribution(
  overrides: Partial<GoalContribution> = {},
): GoalContribution {
  return {
    id: "gc1",
    goal_id: "g1",
    amount: 150_000, // 1,500 AED
    date: "2026-06-01",
    transaction_id: null,
    notes: "",
    ...overrides,
  };
}

test("goalProgressPercent and goalRemainingFils compute integer-fils progress accurately", () => {
  assert.equal(goalProgressPercent(300_000, 1_200_000), 25);
  assert.equal(goalProgressPercent(1_500_000, 1_200_000), 100);
  assert.equal(goalProgressPercent(-500, 1_200_000), 0);
  assert.equal(goalProgressPercent(100, 0), 0);

  assert.equal(goalRemainingFils(300_000, 1_200_000), 900_000);
  assert.equal(goalRemainingFils(1_500_000, 1_200_000), 0);
});

test("monthlyContributionNeeded handles null dates, funded goals, future deadlines, and past deadlines", () => {
  assert.equal(
    monthlyContributionNeeded(makeGoal({ target_date: null }), "2026-06-15"),
    null,
  );
  assert.equal(
    monthlyContributionNeeded(
      makeGoal({ current_amount: 1_200_000, target_date: "2026-12-31" }),
      "2026-06-15",
    ),
    0,
  );
  // 2026-06-15 to 2026-12-15 is 183 days -> ceil(183 / 30.4375) = 7 months? 183/30.4375 = 6.012 -> let's test exact 180 days (6 months)
  // 2026-06-01 to 2026-11-28 is 180 days -> ceil(180 / 30.4375) = 6 months -> 900_000 / 6 = 150_000
  assert.equal(
    monthlyContributionNeeded(makeGoal({ target_date: "2026-11-28" }), "2026-06-01"),
    150_000,
  );
  // Past due date requires full remaining amount immediately
  assert.equal(
    monthlyContributionNeeded(makeGoal({ target_date: "2026-05-01" }), "2026-06-01"),
    900_000,
  );
});

test("estimateMonthlyPace computes trailing 90-day net pace without inflating single deposits", () => {
  const todayIso = "2026-06-15";
  assert.equal(estimateMonthlyPace([], todayIso), 0);

  // Single deposit uses 30-day floor denominator -> 150_000 / (30 / 30.4375) ≈ 152_188
  const single = estimateMonthlyPace(
    [makeContribution({ date: "2026-06-14", amount: 150_000 })],
    todayIso,
  );
  assert.ok(single >= 150_000 && single <= 155_000);

  // Net after withdrawal <= 0 returns 0
  assert.equal(
    estimateMonthlyPace(
      [
        makeContribution({ id: "1", date: "2026-06-01", amount: 100_000 }),
        makeContribution({ id: "2", date: "2026-06-10", amount: -150_000 }),
      ],
      todayIso,
    ),
    0,
  );

  // Contributions older than 90 days are ignored
  assert.equal(
    estimateMonthlyPace(
      [makeContribution({ date: "2026-01-01", amount: 300_000 })],
      todayIso,
    ),
    0,
  );
});

test("projectedCompletionDate and computeGoalHealthStatus classify on_track, behind, completed, and no_target_date", () => {
  const todayIso = "2026-06-15";

  // Completed when funded
  assert.equal(
    projectedCompletionDate(
      makeGoal({ current_amount: 1_200_000 }),
      [],
      todayIso,
    ),
    todayIso,
  );
  assert.equal(
    computeGoalHealthStatus(
      makeGoal({ current_amount: 1_200_000 }),
      [],
      todayIso,
    ),
    "completed",
  );

  // No target date
  assert.equal(
    computeGoalHealthStatus(makeGoal({ target_date: null }), [], todayIso),
    "no_target_date",
  );

  // Zero pace with target date -> null projection & behind
  assert.equal(projectedCompletionDate(makeGoal(), [], todayIso), null);
  assert.equal(computeGoalHealthStatus(makeGoal(), [], todayIso), "behind");

  // Strong pace -> on_track
  const fastContribs = [
    makeContribution({ id: "1", date: "2026-04-20", amount: 300_000 }),
    makeContribution({ id: "2", date: "2026-05-20", amount: 300_000 }),
  ];
  const projectedFast = projectedCompletionDate(
    makeGoal({ target_date: "2026-12-31" }),
    fastContribs,
    todayIso,
  );
  assert.ok(projectedFast !== null && projectedFast <= "2026-12-31");
  assert.equal(
    computeGoalHealthStatus(
      makeGoal({ target_date: "2026-12-31" }),
      fastContribs,
      todayIso,
    ),
    "on_track",
  );

  // Linked recurring schedule can put a goal on track even with no past contributions
  assert.equal(
    computeGoalHealthStatus(
      makeGoal({ target_date: "2026-12-31" }),
      [],
      todayIso,
      200_000,
    ),
    "on_track",
  );
});

test("computeGoalProgress, summarizeGoals, and applyContributionAmount aggregate correctly", () => {
  const g1 = makeGoal({
    id: "g1",
    target_amount: 1_000_000,
    current_amount: 400_000,
    status: "active",
  });
  const g2 = makeGoal({
    id: "g2",
    target_amount: 500_000,
    current_amount: 500_000,
    status: "completed",
  });
  const g3 = makeGoal({
    id: "g3",
    target_amount: 800_000,
    current_amount: 100_000,
    status: "paused",
  });

  const progress = computeGoalProgress(
    g1,
    [
      makeContribution({ id: "c1", goal_id: "g1", date: "2026-05-01" }),
      makeContribution({ id: "c2", goal_id: "g2", date: "2026-05-02" }),
    ],
    "2026-06-15",
  );
  assert.equal(progress.contributions.length, 1);
  assert.equal(progress.remainingFils, 600_000);
  assert.equal(progress.progressPercent, 40);

  const summary = summarizeGoals([g1, g2, g3]);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.pausedCount, 1);
  assert.equal(summary.totalTarget, 1_500_000);
  assert.equal(summary.totalSaved, 900_000);
  assert.equal(summary.overallPercent, 60);

  assert.equal(applyContributionAmount(100_000, 50_000), 150_000);
  assert.equal(applyContributionAmount(100_000, -150_000), 0);
});

test("validateSavingsGoal and validateGoalContribution enforce domain invariants", () => {
  const ledger: Pick<Ledger, "accounts" | "goals" | "transactions"> = {
    accounts: [
      {
        id: "acc1",
        name: "Savings",
        type: "savings",
        opening_balance: 0,
        opening_date: "2026-01-01",
        color: "#1d5b48",
      },
    ],
    goals: [makeGoal()],
    transactions: [],
  };

  validateSavingsGoal(
    {
      name: "Car insurance",
      target_amount: 400_000,
      current_amount: 100_000,
      target_date: "2026-12-01",
      account_id: "acc1",
      color: "#b08448",
      kind: "sinking_fund",
      status: "active",
      notes: "",
    },
    ledger,
  );

  assert.throws(() =>
    validateSavingsGoal(makeGoal({ name: "   " }), ledger),
  );
  assert.throws(() =>
    validateSavingsGoal(makeGoal({ target_amount: 0 }), ledger),
  );
  assert.throws(() =>
    validateSavingsGoal(makeGoal({ current_amount: -1 }), ledger),
  );
  assert.throws(() =>
    validateSavingsGoal(makeGoal({ target_date: "2026-02-30" }), ledger),
  );
  assert.throws(() =>
    validateSavingsGoal(makeGoal({ account_id: "missing" }), ledger),
  );

  validateGoalContribution(makeContribution(), ledger);
  assert.throws(() =>
    validateGoalContribution(makeContribution({ amount: 0 }), ledger),
  );
  assert.throws(() =>
    validateGoalContribution(makeContribution({ goal_id: "missing" }), ledger),
  );
  assert.throws(() =>
    validateGoalContribution(makeContribution({ date: "bad-date" }), ledger),
  );
});

test("demoLedger includes valid goals and contributions", () => {
  const demo = demoLedger();
  assert.ok((demo.goals?.length ?? 0) >= 3);
  assert.ok((demo.goal_contributions?.length ?? 0) >= 3);
  for (const g of demo.goals ?? []) {
    validateSavingsGoal(g, demo);
  }
  for (const c of demo.goal_contributions ?? []) {
    validateGoalContribution(c, demo);
  }
});
