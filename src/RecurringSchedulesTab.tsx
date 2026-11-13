import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import type {
  Ledger,
  RecurringKind,
  RecurringSchedule,
} from "./domain.ts";
import { describeScheduleStatus } from "./recurring.ts";
import type { IntelligentForecast } from "./recurringAutomation.ts";
import {
  formatFullDate,
  frequencyLabels,
  statusLabels,
} from "./RecurringView";

export function RecurringSchedulesTab({
  ledger,
  asOf,
  forecast,
  concealed,
  busy,
  statusFilter,
  setStatusFilter,
  onAddSchedule,
  onEditSchedule,
  onTogglePause,
  onDeleteSchedule,
  onConfirmOccurrence,
}: {
  ledger: Ledger;
  asOf: string;
  forecast: IntelligentForecast;
  concealed: (v: number) => string;
  busy: boolean;
  statusFilter: "all" | "active" | "overdue" | "paused";
  setStatusFilter: (v: "all" | "active" | "overdue" | "paused") => void;
  onAddSchedule: () => void;
  onEditSchedule: (s: RecurringSchedule) => void;
  onTogglePause: (s: RecurringSchedule) => void;
  onDeleteSchedule: (s: RecurringSchedule) => void;
  onConfirmOccurrence: (s: RecurringSchedule, date: string) => void;
}) {
  const [kindFilter, setKindFilter] = useState<"" | RecurringKind>("");
  const [accountFilter, setAccountFilter] = useState("");
  const [search, setSearch] = useState("");

  const accountById = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a])),
    [ledger.accounts],
  );
  const categoryById = useMemo(
    () => new Map(ledger.categories.map((c) => [c.id, c])),
    [ledger.categories],
  );

  const summaries = useMemo(
    () =>
      (ledger.recurring ?? []).map((s) =>
        describeScheduleStatus(s, ledger, asOf),
      ),
    [ledger, asOf],
  );

  const counts = useMemo(
    () => ({
      all: summaries.length,
      active: summaries.filter(
        (s) => s.schedule.status === "active" && s.paymentStatus !== "completed",
      ).length,
      overdue: summaries.filter((s) => s.paymentStatus === "overdue").length,
      paused: summaries.filter((s) => s.schedule.status === "paused").length,
    }),
    [summaries],
  );

  const filteredSchedules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summaries
      .filter((item) => {
        if (
          statusFilter === "active" &&
          (item.schedule.status !== "active" ||
            item.paymentStatus === "completed")
        )
          return false;
        if (statusFilter === "paused" && item.schedule.status !== "paused")
          return false;
        if (statusFilter === "overdue" && item.paymentStatus !== "overdue")
          return false;
        if (kindFilter && item.schedule.type !== kindFilter) return false;
        if (accountFilter && item.schedule.account_id !== accountFilter)
          return false;
        if (q) {
          const cat = categoryById.get(item.schedule.category_id ?? "")?.name ?? "";
          const acc = accountById.get(item.schedule.account_id)?.name ?? "";
          const haystack = `${item.schedule.name} ${item.schedule.notes} ${cat} ${acc}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aDate = a.nextDueDate ?? "9999-12-31";
        const bDate = b.nextDueDate ?? "9999-12-31";
        return (
          aDate.localeCompare(bDate) ||
          a.schedule.name.localeCompare(b.schedule.name)
        );
      });
  }, [
    summaries,
    statusFilter,
    kindFilter,
    accountFilter,
    search,
    categoryById,
    accountById,
  ]);

  return (
    <section className="panel section">
      <div className="panel-heading recurring-panel-head">
        <div>
          <h2>
            Recurring schedules{" "}
            <span className="count">{filteredSchedules.length}</span>
          </h2>
          <p>
            Subscriptions, bills and regular income. Balances update only when
            you confirm a payment.
          </p>
        </div>
        <div
          className="status-tabs"
          role="tablist"
          aria-label="Schedule status filter"
        >
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["overdue", "Overdue"],
              ["paused", "Paused"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={statusFilter === key}
              className={statusFilter === key ? "active" : ""}
              onClick={() => setStatusFilter(key)}
            >
              {label} <span className="tab-count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filters">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search recurring schedules"
            placeholder="Search subscriptions & bills…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter recurring account"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="">All accounts</option>
          {ledger.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter recurring type"
          value={kindFilter}
          onChange={(e) =>
            setKindFilter(e.target.value as "" | RecurringKind)
          }
        >
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
        </select>
      </div>

      {filteredSchedules.length ? (
        <div className="transaction-list">
          {filteredSchedules.map((item) => {
            const { schedule, paymentStatus, nextDueDate, overdueDates } = item;
            const category = categoryById.get(schedule.category_id ?? "");
            const account = accountById.get(schedule.account_id);
            const profile = forecast.profiles[schedule.id];
            return (
              <div
                className="transaction-row recurring-row"
                key={schedule.id}
              >
                <button
                  type="button"
                  className="transaction-main"
                  disabled={busy}
                  onClick={() => onEditSchedule(schedule)}
                >
                  <span
                    className={`transaction-icon ${schedule.type}`}
                    style={
                      category
                        ? {
                            background: category.color + "15",
                            color: category.color,
                          }
                        : undefined
                    }
                  >
                    {category?.emoji ||
                      (schedule.type === "income" ? (
                        <ArrowDownLeft size={19} />
                      ) : (
                        <Tags size={19} />
                      ))}
                  </span>
                  <span className="transaction-description">
                    <b className="recurring-title-line">
                      <span>{schedule.name}</span>
                      <span className={`status-pill ${paymentStatus}`}>
                        {statusLabels[paymentStatus]}
                        {overdueDates.length > 1
                          ? ` (${overdueDates.length})`
                          : ""}
                      </span>
                      <span className="mini-tag">
                        {frequencyLabels[schedule.frequency]}
                      </span>
                      {schedule.amount_type === "variable" && (
                        <span className="mini-tag variable">Variable</span>
                      )}
                    </b>
                    <small>
                      {category?.name ?? "Uncategorized"} ·{" "}
                      {account?.name ?? "Unknown account"} ·{" "}
                      {nextDueDate
                        ? `${paymentStatus === "overdue" ? "Due" : "Next due"} ${formatFullDate(nextDueDate)}`
                        : "No remaining occurrences"}
                      {schedule.end_date
                        ? ` · Ends ${formatFullDate(schedule.end_date)}`
                        : ""}
                    </small>
                  </span>
                  <span className="transaction-value">
                    <b
                      className={schedule.type === "income" ? "green-text" : ""}
                    >
                      {schedule.amount_type === "variable" ? "~" : ""}
                      {schedule.type === "income" ? "+" : "−"}
                      {concealed(schedule.amount)}
                    </b>
                    <small>
                      {schedule.amount_type === "variable"
                        ? profile?.hasRange
                          ? `Range ${concealed(profile.lowAmount)} – ${concealed(profile.highAmount)}`
                          : "Expected · variable"
                        : "Fixed amount"}
                    </small>
                  </span>
                </button>
                <div className="recurring-actions">
                  {schedule.status === "active" && nextDueDate && (
                    <button
                      type="button"
                      className="secondary compact-btn"
                      disabled={busy}
                      onClick={() => onConfirmOccurrence(schedule, nextDueDate)}
                    >
                      Mark paid
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy}
                    aria-label={
                      schedule.status === "paused"
                        ? `Resume ${schedule.name}`
                        : `Pause ${schedule.name}`
                    }
                    title={schedule.status === "paused" ? "Resume" : "Pause"}
                    onClick={() => onTogglePause(schedule)}
                  >
                    {schedule.status === "paused" ? (
                      <Play size={15} />
                    ) : (
                      <Pause size={15} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy}
                    aria-label={`Edit ${schedule.name}`}
                    onClick={() => onEditSchedule(schedule)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button delete"
                    disabled={busy}
                    aria-label={`Delete ${schedule.name}`}
                    onClick={() => onDeleteSchedule(schedule)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <Repeat size={28} />
          <h3>
            {(ledger.recurring ?? []).length
              ? "No schedules match these filters"
              : "No recurring schedules yet"}
          </h3>
          <p>
            {(ledger.recurring ?? []).length
              ? "Try switching filters or clearing your search."
              : "Add your subscriptions, utility bills or salary to see upcoming dates."}
          </p>
          {!(ledger.recurring ?? []).length && (
            <button
              type="button"
              className="primary empty-cta"
              disabled={busy}
              onClick={onAddSchedule}
            >
              <Plus size={16} /> Add recurring
            </button>
          )}
        </div>
      )}
    </section>
  );
}
