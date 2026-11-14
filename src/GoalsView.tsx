import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Calendar,
  Minus,
  Pencil,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { confirmDialog } from "./dialogStore";
import {
  errorMessage,
  minor,
  today,
  type GoalContribution,
  type GoalKind,
  type GoalStatus,
  type Ledger,
  type SavingsGoal,
  type Transaction,
} from "./domain";
import {
  computeGoalProgress,
  summarizeGoals,
  validateGoalContribution,
  validateSavingsGoal,
  type GoalHealthStatus,
  type GoalProgress,
} from "./goals";

export type GoalDraft = Omit<SavingsGoal, "id">;

const GOAL_COLORS = [
  "#1d5b48",
  "#b08448",
  "#619a92",
  "#696198",
  "#768db1",
  "#b68aa0",
  "#c79857",
];

const HEALTH_LABELS: Record<GoalHealthStatus, string> = {
  on_track: "On track",
  behind: "Behind pace",
  completed: "Funded",
  no_target_date: "Flexible date",
};

function formatDateShort(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}

function GoalCard({
  item,
  ledger,
  concealed,
  busy,
  onContribute,
  onEdit,
  onDelete,
  onDeleteContribution,
}: {
  item: GoalProgress;
  ledger: Ledger;
  concealed: (v: number) => string;
  busy: boolean;
  onContribute: (goal: SavingsGoal) => void;
  onEdit: (goal: SavingsGoal) => void;
  onDelete: (goal: SavingsGoal) => void;
  onDeleteContribution: (c: GoalContribution) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const { goal } = item;
  const linkedAccount = goal.account_id
    ? ledger.accounts.find((a) => a.id === goal.account_id)
    : undefined;

  const pctRounded = Math.round(item.progressPercent);
  const barStatus =
    goal.status === "paused"
      ? "paused"
      : item.healthStatus === "completed"
        ? "completed"
        : item.healthStatus === "behind"
          ? "behind"
          : "on_track";

  return (
    <article className={`panel goal-card ${goal.status}`}>
      <div className="goal-card-head">
        <div className="goal-title-wrap">
          <span
            className="goal-symbol"
            style={{ background: goal.color + "18", color: goal.color }}
          >
            {goal.emoji || <Target size={20} />}
          </span>
          <div>
            <div className="goal-badges">
              <span className="goal-kind-pill">
                {goal.kind === "sinking_fund" ? "Sinking fund" : "Savings goal"}
              </span>
              {goal.status === "paused" ? (
                <span className="goal-health-pill paused">Paused</span>
              ) : (
                <span className={`goal-health-pill ${item.healthStatus}`}>
                  {HEALTH_LABELS[item.healthStatus]}
                </span>
              )}
            </div>
            <h3>{goal.name}</h3>
            {linkedAccount && (
              <small className="muted">Linked to {linkedAccount.name}</small>
            )}
          </div>
        </div>
        <div className="goal-card-actions">
          <button
            type="button"
            className="secondary goal-contrib-btn"
            disabled={busy}
            onClick={() => onContribute(goal)}
          >
            <Plus size={15} />
            Contribute
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit ${goal.name}`}
            disabled={busy}
            onClick={() => onEdit(goal)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Delete ${goal.name}`}
            disabled={busy}
            onClick={() => onDelete(goal)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="goal-amounts">
        <div>
          <strong>{concealed(item.effectiveAmount)}</strong>{" "}
          <span className="muted">of {concealed(goal.target_amount)}</span>
        </div>
        <span className="goal-pct">{pctRounded}%</span>
      </div>

      <div
        className="goal-bar"
        role="progressbar"
        aria-label={`${goal.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pctRounded)}
        aria-valuetext={`${pctRounded}% funded`}
      >
        <span
          className={barStatus}
          style={{
            width: `${Math.min(100, item.progressPercent)}%`,
            background:
              barStatus === "on_track" ? goal.color : undefined,
          }}
        />
      </div>

      <div className="goal-meta-grid">
        <div>
          <small>Remaining</small>
          <b>
            {item.remainingFils === 0
              ? "Fully funded"
              : concealed(item.remainingFils)}
          </b>
        </div>
        <div>
          <small>Monthly needed</small>
          <b>
            {item.monthlyNeeded === null
              ? "No deadline"
              : item.monthlyNeeded === 0
                ? "Done"
                : `${concealed(item.monthlyNeeded)}/mo`}
          </b>
        </div>
        <div>
          <small>Target date</small>
          <b>{goal.target_date ? formatDateShort(goal.target_date) : "—"}</b>
        </div>
        <div>
          <small>Projected</small>
          <b>
            {item.remainingFils === 0
              ? "Funded"
              : item.projectedDate
                ? formatDateShort(item.projectedDate)
                : "Need pace"}
          </b>
        </div>
      </div>

      {goal.notes && <p className="goal-notes">{goal.notes}</p>}

      {item.contributions.length > 0 && (
        <div className="goal-history-wrap">
          <button
            type="button"
            className="text-button goal-history-toggle"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Hide" : "Show"} activity ({item.contributions.length})
          </button>
          {showHistory && (
            <ul className="goal-history-list">
              {item.contributions.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <div>
                    <span className="muted">{formatDateShort(c.date)}</span>
                    {c.notes && <span> · {c.notes}</span>}
                  </div>
                  <div className="goal-history-right">
                    <b className={c.amount >= 0 ? "green-text" : "terracotta-text"}>
                      {c.amount >= 0 ? "+" : "−"}
                      {concealed(Math.abs(c.amount))}
                    </b>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove contribution entry"
                      disabled={busy}
                      onClick={() => onDeleteContribution(c)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

export function GoalsPage({
  ledger,
  concealed,
  busy,
  onAddGoal,
  onEditGoal,
  onDeleteGoal,
  onContributeGoal,
  onDeleteContribution,
}: {
  ledger: Ledger;
  concealed: (v: number) => string;
  busy: boolean;
  onAddGoal: () => void;
  onEditGoal: (goal: SavingsGoal) => void;
  onDeleteGoal: (goal: SavingsGoal) => Promise<void>;
  onContributeGoal: (goal: SavingsGoal) => void;
  onDeleteContribution: (c: GoalContribution) => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "completed" | "paused"
  >("all");
  const [kindFilter, setKindFilter] = useState<"all" | GoalKind>("all");

  const goals = ledger.goals ?? [];
  const contributions = ledger.goal_contributions ?? [];
  const todayIso = today();

  const summary = useMemo(() => summarizeGoals(goals), [goals]);

  const progressList = useMemo(
    () =>
      goals
        .map((g) => computeGoalProgress(g, contributions, todayIso))
        .sort((a, b) => {
          const order: Record<GoalStatus, number> = {
            active: 0,
            paused: 1,
            completed: 2,
          };
          if (order[a.goal.status] !== order[b.goal.status]) {
            return order[a.goal.status] - order[b.goal.status];
          }
          if (a.goal.target_date && b.goal.target_date) {
            return a.goal.target_date.localeCompare(b.goal.target_date);
          }
          return a.goal.name.localeCompare(b.goal.name);
        }),
    [goals, contributions, todayIso],
  );

  const filtered = useMemo(
    () =>
      progressList.filter((item) => {
        if (statusFilter !== "all" && item.goal.status !== statusFilter) {
          return false;
        }
        if (kindFilter !== "all" && item.goal.kind !== kindFilter) {
          return false;
        }
        return true;
      }),
    [progressList, statusFilter, kindFilter],
  );

  async function handleDeleteGoal(goal: SavingsGoal) {
    const ok = await confirmDialog({
      title: "Delete goal?",
      message: `Remove "${goal.name}" and its contribution history? Linked ledger transactions will remain untouched.`,
      confirmLabel: "Delete goal",
      tone: "danger",
    });
    if (ok) await onDeleteGoal(goal);
  }

  return (
    <div className="goals-page">
      <section className="stats goals-stats">
        <article className="stat net">
          <div className="stat-label">Saved toward goals</div>
          <h2>{concealed(summary.totalSaved)}</h2>
          <small>
            {summary.overallPercent}% of {concealed(summary.totalTarget)} target
          </small>
        </article>
        <article className="stat">
          <div className="stat-label">Active goals</div>
          <h2>{summary.activeCount}</h2>
          <small>
            {summary.completedCount} completed · {summary.pausedCount} paused
          </small>
        </article>
        <article className="stat">
          <div className="stat-label">Remaining to fund</div>
          <h2>{concealed(Math.max(0, summary.totalTarget - summary.totalSaved))}</h2>
          <small>Across active and completed targets</small>
        </article>
      </section>

      <div className="goals-toolbar">
        <div className="tabs" role="tablist" aria-label="Filter goals by status">
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["completed", "Completed"],
              ["paused", "Paused"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={statusFilter === key}
              className={`tab-btn ${statusFilter === key ? "active" : ""}`}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="goals-kind-filter">
          <select
            aria-label="Filter by goal type"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as "all" | GoalKind)}
          >
            <option value="all">All types</option>
            <option value="savings">Savings goals</option>
            <option value="sinking_fund">Sinking funds</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <section className="panel goals-empty">
          <Target size={28} className="muted" />
          <h3>
            {goals.length === 0
              ? "Give your savings a clear destination"
              : "No goals match these filters"}
          </h3>
          <p className="muted">
            {goals.length === 0
              ? "Create a savings goal for an emergency fund or a sinking fund for annual expenses like car insurance and travel."
              : "Try switching the status or type filter above."}
          </p>
          {goals.length === 0 && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={onAddGoal}
            >
              <Plus size={16} />
              Create your first goal
            </button>
          )}
        </section>
      ) : (
        <div className="goals-grid">
          {filtered.map((item) => (
            <GoalCard
              key={item.goal.id}
              item={item}
              ledger={ledger}
              concealed={concealed}
              busy={busy}
              onContribute={onContributeGoal}
              onEdit={onEditGoal}
              onDelete={handleDeleteGoal}
              onDeleteContribution={onDeleteContribution}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardGoals({
  ledger,
  concealed,
  onOpenGoals,
  onAddGoal,
  onContributeGoal,
}: {
  ledger: Ledger;
  concealed: (v: number) => string;
  onOpenGoals: () => void;
  onAddGoal: () => void;
  onContributeGoal: (goal: SavingsGoal) => void;
}) {
  const goals = ledger.goals ?? [];
  const contributions = ledger.goal_contributions ?? [];
  const todayIso = today();

  const active = useMemo(
    () =>
      goals
        .filter((g) => g.status === "active")
        .map((g) => computeGoalProgress(g, contributions, todayIso))
        .slice(0, 3),
    [goals, contributions, todayIso],
  );

  const summary = useMemo(() => summarizeGoals(goals), [goals]);

  return (
    <section className="section">
      <div className="section-title">
        <h2>
          Savings goals <span className="count">{goals.length}</span>
        </h2>
        <div className="goal-dashboard-actions">
          <button type="button" className="text-button" onClick={onOpenGoals}>
            View all goals <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {goals.length === 0 ? (
        <article className="panel goal-dashboard-empty">
          <div>
            <b>Set a savings goal or sinking fund</b>
            <p className="muted">
              Track your emergency reserve, annual renewals, or upcoming trips.
            </p>
          </div>
          <button type="button" className="secondary" onClick={onAddGoal}>
            <Plus size={15} /> Add goal
          </button>
        </article>
      ) : (
        <div className="goal-dashboard-grid">
          {active.map((item) => (
            <article className="panel goal-mini-card" key={item.goal.id}>
              <div className="goal-mini-head">
                <span
                  className="goal-symbol small"
                  style={{
                    background: item.goal.color + "18",
                    color: item.goal.color,
                  }}
                >
                  {item.goal.emoji || <Target size={16} />}
                </span>
                <div className="goal-mini-title">
                  <b>{item.goal.name}</b>
                  <small className="muted">
                    {concealed(item.effectiveAmount)} of{" "}
                    {concealed(item.goal.target_amount)}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  title="Contribute"
                  aria-label={`Contribute to ${item.goal.name}`}
                  onClick={() => onContributeGoal(item.goal)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="goal-bar">
                <span
                  className={
                    item.healthStatus === "completed"
                      ? "completed"
                      : item.healthStatus === "behind"
                        ? "behind"
                        : "on_track"
                  }
                  style={{
                    width: `${Math.min(100, item.progressPercent)}%`,
                    background:
                      item.healthStatus === "on_track"
                        ? item.goal.color
                        : undefined,
                  }}
                />
              </div>
              <div className="goal-mini-foot">
                <span className="muted">
                  {Math.round(item.progressPercent)}% funded
                </span>
                {item.monthlyNeeded !== null && item.monthlyNeeded > 0 && (
                  <span className="muted">
                    {concealed(item.monthlyNeeded)}/mo needed
                  </span>
                )}
              </div>
            </article>
          ))}
          {active.length === 0 && (
            <article className="panel goal-dashboard-empty">
              <div>
                <b>{summary.completedCount} goals completed</b>
                <p className="muted">
                  All active targets are funded. Ready for the next milestone?
                </p>
              </div>
              <button type="button" className="secondary" onClick={onAddGoal}>
                <Plus size={15} /> Add goal
              </button>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

export function GoalEditorModal({
  ledger,
  item,
  busy,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  item?: SavingsGoal;
  busy: boolean;
  onClose: () => void;
  onSave: (value: GoalDraft, id?: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [color, setColor] = useState(item?.color ?? GOAL_COLORS[0]);
  const [kind, setKind] = useState<GoalKind>(item?.kind ?? "savings");
  const [status, setStatus] = useState<GoalStatus>(item?.status ?? "active");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();

    try {
      const value: GoalDraft = {
        name: s("name"),
        target_amount: minor(s("target_amount")),
        current_amount: s("current_amount") ? minor(s("current_amount")) : 0,
        target_date: s("target_date") || null,
        account_id: s("account_id") || null,
        color,
        emoji: s("emoji") || undefined,
        kind,
        status,
        notes: s("notes"),
      };
      validateSavingsGoal({ ...value, id: item?.id }, ledger);
      await onSave(value, item?.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="goal-modal-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">SAVE WITH PURPOSE</span>
          <h2 id="goal-modal-title">{item ? "Edit" : "New"} goal</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>

      <form onSubmit={submit}>
        <div className="form-row">
          <label style={{ flex: 1 }}>
            Goal name
            <input
              name="name"
              required
              autoFocus
              maxLength={80}
              placeholder="e.g. Emergency reserve"
              defaultValue={item?.name ?? ""}
            />
          </label>
          <label style={{ width: 90 }}>
            Emoji
            <input
              name="emoji"
              maxLength={8}
              placeholder="🛟"
              defaultValue={item?.emoji ?? ""}
            />
          </label>
        </div>

        <div className="form-row">
          <label>
            Goal type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as GoalKind)}
            >
              <option value="savings">Savings goal</option>
              <option value="sinking_fund">Sinking fund</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as GoalStatus)}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Target amount <span className="muted">AED</span>
            <input
              name="target_amount"
              required
              inputMode="decimal"
              placeholder="10000.00"
              defaultValue={
                item ? (item.target_amount / 100).toFixed(2) : ""
              }
            />
          </label>
          <label>
            Current saved <span className="muted">AED</span>
            <input
              name="current_amount"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={
                item ? (item.current_amount / 100).toFixed(2) : "0.00"
              }
            />
          </label>
        </div>

        <div className="form-row">
          <label>
            Target date <span className="muted">Optional</span>
            <input
              name="target_date"
              type="date"
              min="1970-01-01"
              max="2100-12-31"
              defaultValue={item?.target_date ?? ""}
            />
          </label>
          <label>
            Linked account <span className="muted">Optional</span>
            <select name="account_id" defaultValue={item?.account_id ?? ""}>
              <option value="">None</option>
              {ledger.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Color
          <div className="swatches">
            {GOAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Select color ${c}`}
                className={`swatch ${color === c ? "selected" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </label>

        <label>
          Notes <span className="muted">Optional</span>
          <textarea
            name="notes"
            rows={2}
            maxLength={500}
            placeholder="What is this goal for?"
            defaultValue={item?.notes ?? ""}
          />
        </label>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save goal"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function GoalContributeModal({
  ledger,
  goal,
  busy,
  onClose,
  onSubmit,
}: {
  ledger: Ledger;
  goal: SavingsGoal;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    goal: SavingsGoal;
    amount: number;
    date: string;
    notes: string;
    recordTransaction?: Omit<Transaction, "id">;
  }) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"contribute" | "withdraw">(
    "contribute",
  );
  const [recordTx, setRecordTx] = useState(false);
  const [txType, setTxType] = useState<"transfer" | "expense">("transfer");
  const defaultSource =
    ledger.accounts.find((a) => a.id !== goal.account_id)?.id ??
    ledger.accounts[0]?.id ??
    "";
  const [sourceAccountId, setSourceAccountId] = useState(defaultSource);
  const [destAccountId, setDestAccountId] = useState(
    goal.account_id ??
      ledger.accounts.find((a) => a.id !== defaultSource)?.id ??
      "",
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();

    try {
      const absAmount = minor(s("amount"));
      if (absAmount <= 0) {
        throw new Error("Enter an amount greater than zero.");
      }
      const signedAmount =
        direction === "contribute" ? absAmount : -absAmount;
      if (direction === "withdraw" && absAmount > goal.current_amount) {
        throw new Error("Cannot withdraw more than the goal's current balance.");
      }
      const date = s("date");
      const notes = s("notes");

      validateGoalContribution(
        {
          goal_id: goal.id,
          amount: signedAmount,
          date,
          transaction_id: null,
          notes,
        },
        ledger,
      );

      let recordTransaction: Omit<Transaction, "id"> | undefined;
      if (recordTx) {
        if (!sourceAccountId) throw new Error("Select a source account.");
        if (txType === "transfer") {
          if (!destAccountId || destAccountId === sourceAccountId) {
            throw new Error("Choose two different accounts for a transfer.");
          }
          recordTransaction = {
            type: "transfer",
            amount: absAmount,
            account_id: sourceAccountId,
            to_account_id: destAccountId,
            category_id: null,
            date,
            payee: goal.name,
            notes: notes || `Goal ${direction}: ${goal.name}`,
          };
        } else {
          recordTransaction = {
            type: "expense",
            amount: absAmount,
            account_id: sourceAccountId,
            to_account_id: null,
            category_id: s("category_id") || null,
            date,
            payee: goal.name,
            notes: notes || `Goal ${direction}: ${goal.name}`,
          };
        }
      }

      await onSubmit({
        goal,
        amount: signedAmount,
        date,
        notes,
        recordTransaction,
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="goal-contrib-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">{goal.name.toUpperCase()}</span>
          <h2 id="goal-contrib-title">Contribute or withdraw</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>

      <form onSubmit={submit}>
        <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
          <button
            type="button"
            role="tab"
            aria-selected={direction === "contribute"}
            className={`tab-btn ${direction === "contribute" ? "active" : ""}`}
            onClick={() => setDirection("contribute")}
          >
            <Plus size={14} /> Contribute
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={direction === "withdraw"}
            className={`tab-btn ${direction === "withdraw" ? "active" : ""}`}
            onClick={() => setDirection("withdraw")}
          >
            <Minus size={14} /> Withdraw
          </button>
        </div>

        <div className="form-row">
          <label>
            Amount <span className="muted">AED</span>
            <input
              name="amount"
              required
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <label>
            Date
            <input
              name="date"
              type="date"
              required
              defaultValue={today()}
              min="1970-01-01"
              max="2100-12-31"
            />
          </label>
        </div>

        <label>
          Notes <span className="muted">Optional</span>
          <input
            name="notes"
            maxLength={500}
            placeholder={
              direction === "contribute"
                ? "Monthly savings top-up"
                : "Used for planned expense"
            }
          />
        </label>

        {ledger.accounts.length > 0 && (
          <label className="budget-check" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={recordTx}
              onChange={(e) => setRecordTx(e.target.checked)}
            />
            Also record a transaction in your ledger
          </label>
        )}

        {recordTx && (
          <div className="goal-tx-box">
            <div className="form-row">
              <label>
                Transaction type
                <select
                  value={txType}
                  onChange={(e) =>
                    setTxType(e.target.value as "transfer" | "expense")
                  }
                >
                  <option value="transfer">Transfer between accounts</option>
                  <option value="expense">Expense</option>
                </select>
              </label>
              <label>
                {txType === "transfer" ? "From account" : "Account"}
                <select
                  value={sourceAccountId}
                  onChange={(e) => setSourceAccountId(e.target.value)}
                >
                  {ledger.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {txType === "transfer" ? (
              <label>
                To account
                <select
                  value={destAccountId}
                  onChange={(e) => setDestAccountId(e.target.value)}
                >
                  {ledger.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Category <span className="muted">Optional</span>
                <select name="category_id" defaultValue="">
                  <option value="">Uncategorized</option>
                  {ledger.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : direction === "contribute"
                ? "Add contribution"
                : "Record withdrawal"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
