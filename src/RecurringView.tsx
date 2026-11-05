import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Lightbulb,
  Link2,
  List,
  Pause,
  Pencil,
  Play,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Tags,
  Trash2,
  TrendingUp,
  Unlink,
  X,
} from "lucide-react";
import {
  errorMessage,
  minor,
  money,
  shiftMonth,
  today,
  type AutoDetectSetting,
  type AutoMatchSetting,
  type Ledger,
  type RecurringAmountType,
  type RecurringFrequency,
  type RecurringKind,
  type RecurringOccurrenceRecord,
  type RecurringPreferences,
  type RecurringSchedule,
  type RecurringStatus,
  type Transaction,
} from "./domain.ts";
import {
  MAX_RECURRING_DATE,
  MIN_RECURRING_DATE,
  addDays,
  buildConfirmTransaction,
  dashboardRecurringSummary,
  daysInMonth,
  describeScheduleStatus,
  formatIsoDate,
  listOccurrences,
  monthRange,
  parseIsoDate,
  validateOccurrenceConfirmation,
  validateRecurringSchedule,
  type OccurrenceItem,
  type SchedulePaymentStatus,
} from "./recurring.ts";
import {
  buildIntelligentForecast,
  detectRecurringPatterns,
  reconcileTransactions,
  type DetectedPattern,
  type ForecastItem,
  type IntelligentForecast,
  type MatchCandidate,
} from "./recurringAutomation.ts";

export const frequencyLabels: Record<RecurringFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const statusLabels: Record<SchedulePaymentStatus, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  paid: "Paid",
  paused: "Paused",
  completed: "Completed",
};

export function formatShortDate(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dubai",
  });
}

export function formatFullDate(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}

export function formatMonthYear(month: string) {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}

export function DashboardRecurring({
  ledger,
  month,
  concealed,
  busy,
  onOpenRecurring,
  onConfirm,
}: {
  ledger: Ledger;
  month: string;
  concealed: (v: number) => string;
  busy: boolean;
  onOpenRecurring: (
    tab?: "schedules" | "suggestions" | "upcoming" | "history" | "insights",
    filter?: "all" | "active" | "overdue" | "paused",
  ) => void;
  onConfirm: (schedule: RecurringSchedule, occurrenceDate: string) => void;
}) {
  const asOf = today();
  const summary = useMemo(
    () => dashboardRecurringSummary(ledger, asOf, month),
    [ledger, asOf, month],
  );
  const forecast = useMemo(
    () => buildIntelligentForecast(ledger, asOf),
    [ledger, asOf],
  );
  const detected = useMemo(
    () => detectRecurringPatterns(ledger, { asOfDate: asOf }),
    [ledger, asOf],
  );
  const reconciliation = useMemo(
    () => reconcileTransactions(ledger, { asOfDate: asOf }),
    [ledger, asOf],
  );

  const pendingAttentionCount =
    detected.length + reconciliation.reviewCandidates.length;
  const hasSchedules = (ledger.recurring ?? []).length > 0;
  const monthName = formatMonthYear(month);

  return (
    <div className="overview-bottom recurring-overview">
      <section className="panel recurring-forecast-panel">
        <div className="panel-heading">
          <div>
            <h2>Monthly recurring · {monthName}</h2>
            <p>Recorded ledger totals stay separate from scheduled forecasts</p>
          </div>
          <button
            className="text-button"
            onClick={() => onOpenRecurring("schedules", "all")}
          >
            Manage <ArrowRight size={15} />
          </button>
        </div>

        {pendingAttentionCount > 0 && (
          <div className="recurring-suggestion-banner">
            <div className="suggestion-banner-left">
              <span className="round-icon gold">
                <Sparkles size={17} />
              </span>
              <div>
                <b>
                  {pendingAttentionCount} recurring pattern
                  {pendingAttentionCount > 1 ? "s" : ""} to review
                </b>
                <p>
                  {detected.length > 0 &&
                    `${detected.length} unscheduled pattern${detected.length > 1 ? "s" : ""} discovered`}
                  {detected.length > 0 &&
                    reconciliation.reviewCandidates.length > 0 &&
                    " · "}
                  {reconciliation.reviewCandidates.length > 0 &&
                    `${reconciliation.reviewCandidates.length} payment match${reconciliation.reviewCandidates.length > 1 ? "es" : ""} awaiting confirmation`}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="secondary compact-btn"
              onClick={() => onOpenRecurring("suggestions")}
            >
              Review suggestions <ArrowRight size={13} />
            </button>
          </div>
        )}

        {hasSchedules ? (
          <div className="recurring-breakdown">
            <div className="recurring-metric-box">
              <div className="recurring-metric-head">
                <span>Estimated recurring expenses</span>
                <strong>{concealed(summary.monthly.estimated.expense)}</strong>
              </div>
              <div className="recurring-metric-sub">
                <span>
                  Paid (recorded): {concealed(summary.monthly.confirmed.expense)}
                </span>
                <span>
                  Remaining forecast:{" "}
                  {concealed(summary.monthly.unconfirmed.expense)}
                </span>
              </div>
              <div className="recurring-metric-foot">
                Actual {monthName} expenses{" "}
                {concealed(summary.monthly.actual.expense)} · Projected month
                total <b>{concealed(summary.monthly.projected.expense)}</b>
              </div>
            </div>
            <div className="recurring-metric-box">
              <div className="recurring-metric-head">
                <span>Estimated recurring income</span>
                <strong className="green-text">
                  {concealed(summary.monthly.estimated.income)}
                </strong>
              </div>
              <div className="recurring-metric-sub">
                <span>
                  Received (recorded):{" "}
                  {concealed(summary.monthly.confirmed.income)}
                </span>
                <span>
                  Remaining forecast:{" "}
                  {concealed(summary.monthly.unconfirmed.income)}
                </span>
              </div>
              <div className="recurring-metric-foot">
                Actual {monthName} income{" "}
                {concealed(summary.monthly.actual.income)} · Projected month
                total{" "}
                <b className="green-text">
                  {concealed(summary.monthly.projected.income)}
                </b>
              </div>
            </div>

            <div className="recurring-safe-note-wrap">
              <p className="recurring-safe-note">
                Linked payments are counted once in recorded totals and never
                modify balances twice.
              </p>
              <button
                type="button"
                className="text-link-button small"
                onClick={() => onOpenRecurring("insights")}
              >
                View 30/60/90d cash flow insights <ArrowRight size={12} />
              </button>
            </div>
          </div>
        ) : (
          <div className="empty">
            <Repeat size={28} />
            <h3>Plan regular bills &amp; income</h3>
            <p>
              Track subscriptions, rent, utilities and salary without changing
              account balances early.
            </p>
          </div>
        )}
      </section>

      <section className="panel recurring-upcoming-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Upcoming · next 30 days{" "}
              <span className="count">
                {forecast.horizons[30].unconfirmedCount}
              </span>
            </h2>
            <p>
              Forecast: −{concealed(forecast.horizons[30].expense.expected)}{" "}
              expenses · +{concealed(forecast.horizons[30].income.expected)}{" "}
              income
            </p>
          </div>
          <div className="recurring-head-actions">
            {summary.overdueCount > 0 && (
              <button
                className="status-pill overdue"
                onClick={() => onOpenRecurring("schedules", "overdue")}
              >
                {summary.overdueCount} overdue
              </button>
            )}
            <button
              className="text-button"
              onClick={() => onOpenRecurring("upcoming")}
            >
              View all <ArrowRight size={15} />
            </button>
          </div>
        </div>
        {summary.upcoming30Days.items.length ? (
          <div className="transaction-list">
            {summary.upcoming30Days.items.slice(0, 5).map((item) => {
              const category = ledger.categories.find(
                (c) => c.id === item.schedule.category_id,
              );
              const account = ledger.accounts.find(
                (a) => a.id === item.schedule.account_id,
              );
              const profile = forecast.profiles[item.schedule.id];
              return (
                <div
                  className="transaction-row recurring-occ-row"
                  key={`${item.schedule.id}:${item.date}`}
                >
                  <div className="transaction-main as-static">
                    <span
                      className={`transaction-icon ${item.schedule.type}`}
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
                        (item.schedule.type === "income" ? (
                          <ArrowDownLeft size={19} />
                        ) : (
                          <Repeat size={18} />
                        ))}
                    </span>
                    <span className="transaction-description">
                      <b className="recurring-title-line">
                        <span>{item.schedule.name}</span>
                        {item.schedule.amount_type === "variable" && (
                          <span className="mini-tag variable">Variable</span>
                        )}
                      </b>
                      <small>
                        {account?.name ?? "Account"} ·{" "}
                        {item.status === "due_today"
                          ? "Due today"
                          : `Due ${formatShortDate(item.date)}`}{" "}
                        · Forecast
                      </small>
                    </span>
                    <span className="transaction-value">
                      <b
                        className={
                          item.schedule.type === "income" ? "green-text" : ""
                        }
                      >
                        {item.schedule.amount_type === "variable" ? "~" : ""}
                        {item.schedule.type === "income" ? "+" : "−"}
                        {concealed(
                          profile?.expectedAmount ?? item.schedule.amount,
                        )}
                      </b>
                      <small>
                        {frequencyLabels[item.schedule.frequency]}
                        {profile?.hasRange && (
                          <span className="range-caption">
                            {" "}
                            ({concealed(profile.lowAmount)} –{" "}
                            {concealed(profile.highAmount)})
                          </span>
                        )}
                      </small>
                    </span>
                  </div>
                  <button
                    className="secondary compact-btn"
                    disabled={busy}
                    onClick={() => onConfirm(item.schedule, item.date)}
                  >
                    Mark paid
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <Calendar size={28} />
            <h3>Nothing due in the next 30 days</h3>
            <p>
              All upcoming scheduled payments for the next 30 days are clear.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export type RecurringTab =
  | "schedules"
  | "suggestions"
  | "upcoming"
  | "history"
  | "insights";

export function RecurringPage({
  ledger,
  concealed,
  busy,
  initialTab = "schedules",
  initialFilter = "all",
  onAddSchedule,
  onEditSchedule,
  onTogglePause,
  onDeleteSchedule,
  onConfirmOccurrence,
  onUnlinkOccurrence,
  onRelinkOccurrence,
  onAcceptPattern,
  onEditPattern,
  onDismissPattern,
  onConfirmMatchCandidate,
  onDismissMatchCandidate,
  onUpdatePreferences,
  onRestoreDismissed,
  onRunReconciliation,
}: {
  ledger: Ledger;
  concealed: (v: number) => string;
  busy: boolean;
  initialTab?: RecurringTab;
  initialFilter?: "all" | "active" | "overdue" | "paused";
  onAddSchedule: () => void;
  onEditSchedule: (s: RecurringSchedule) => void;
  onTogglePause: (s: RecurringSchedule) => void;
  onDeleteSchedule: (s: RecurringSchedule) => void;
  onConfirmOccurrence: (s: RecurringSchedule, date: string) => void;
  onUnlinkOccurrence: (occurrenceId: string) => void;
  onRelinkOccurrence?: (
    existing: RecurringOccurrenceRecord,
    s: RecurringSchedule,
    date: string,
  ) => void;
  onAcceptPattern?: (pattern: DetectedPattern) => Promise<void> | void;
  onEditPattern?: (pattern: DetectedPattern) => void;
  onDismissPattern?: (patternKey: string) => Promise<void> | void;
  onConfirmMatchCandidate?: (candidate: MatchCandidate) => Promise<void> | void;
  onDismissMatchCandidate?: (matchKey: string) => Promise<void> | void;
  onUpdatePreferences?: (
    prefs: Partial<RecurringPreferences>,
  ) => Promise<void> | void;
  onRestoreDismissed?: () => Promise<void> | void;
  onRunReconciliation?: () => Promise<void> | void;
}) {
  const asOf = today();
  const [activeTab, setActiveTab] = useState<RecurringTab>(initialTab);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "overdue" | "paused"
  >(initialFilter);
  const [kindFilter, setKindFilter] = useState<"" | RecurringKind>("");
  const [accountFilter, setAccountFilter] = useState("");
  const [search, setSearch] = useState("");
  const [upcomingView, setUpcomingView] = useState<"timeline" | "calendar">(
    "timeline",
  );
  const [horizonDays, setHorizonDays] = useState<30 | 60 | 90>(30);
  const [showRecentPaid, setShowRecentPaid] = useState(true);
  const [calMonth, setCalMonth] = useState(asOf.slice(0, 7));
  const [showSettings, setShowSettings] = useState(false);
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setStatusFilter(initialFilter);
  }, [initialFilter]);

  const dashboard = useMemo(
    () => dashboardRecurringSummary(ledger, asOf, asOf.slice(0, 7)),
    [ledger, asOf],
  );

  const forecast: IntelligentForecast = useMemo(
    () => buildIntelligentForecast(ledger, asOf),
    [ledger, asOf],
  );

  const detectedPatterns: DetectedPattern[] = useMemo(
    () => detectRecurringPatterns(ledger, { asOfDate: asOf }),
    [ledger, asOf],
  );

  const reconciliation = useMemo(
    () => reconcileTransactions(ledger, { asOfDate: asOf }),
    [ledger, asOf],
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
      active: summaries.filter((s) => s.schedule.status === "active").length,
      overdue: summaries.filter((s) => s.paymentStatus === "overdue").length,
      paused: summaries.filter((s) => s.schedule.status === "paused").length,
    }),
    [summaries],
  );

  const filteredSchedules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summaries
      .filter((item) => {
        if (statusFilter === "active" && item.schedule.status !== "active")
          return false;
        if (statusFilter === "paused" && item.schedule.status !== "paused")
          return false;
        if (statusFilter === "overdue" && item.paymentStatus !== "overdue")
          return false;
        if (kindFilter && item.schedule.type !== kindFilter) return false;
        if (accountFilter && item.schedule.account_id !== accountFilter)
          return false;
        if (q) {
          const cat =
            ledger.categories.find((c) => c.id === item.schedule.category_id)
              ?.name ?? "";
          const acc =
            ledger.accounts.find((a) => a.id === item.schedule.account_id)
              ?.name ?? "";
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
    ledger.categories,
    ledger.accounts,
  ]);

  const upcomingFilteredItems = useMemo(() => {
    const toDate = addDays(asOf, horizonDays);
    return forecast.upcomingItems.filter(
      (it) => it.scheduledDate >= asOf && it.scheduledDate <= toDate,
    );
  }, [forecast.upcomingItems, asOf, horizonDays]);

  const calendarData = useMemo(() => {
    const { start, end } = monthRange(calMonth);
    const items = listOccurrences(ledger, start, end, {
      asOfDate: asOf,
      includeConfirmed: true,
      includePaused: false,
    });
    const byDate = new Map<string, OccurrenceItem[]>();
    for (const item of items) {
      const list = byDate.get(item.date) ?? [];
      list.push(item);
      byDate.set(item.date, list);
    }
    const parsed = parseIsoDate(start)!;
    const firstWeekday =
      (new Date(Date.UTC(parsed.year, parsed.month - 1, 1)).getUTCDay() + 6) %
      7; // Monday = 0
    const totalDays = daysInMonth(parsed.year, parsed.month);
    const cells: ({ day: number; date: string; items: OccurrenceItem[] } | null)[] =
      [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let day = 1; day <= totalDays; day++) {
      const date = formatIsoDate(parsed.year, parsed.month, day);
      cells.push({ day, date, items: byDate.get(date) ?? [] });
    }
    return { cells, items };
  }, [ledger, calMonth, asOf]);

  const historyItems = useMemo(() => {
    const txById = new Map(ledger.transactions.map((t) => [t.id, t]));
    const schedById = new Map((ledger.recurring ?? []).map((s) => [s.id, s]));
    return (ledger.recurring_occurrences ?? [])
      .map((occ) => ({
        occ,
        tx: txById.get(occ.transaction_id),
        schedule: schedById.get(occ.recurring_id),
      }))
      .sort((a, b) => b.occ.occurrence_date.localeCompare(a.occ.occurrence_date));
  }, [ledger.recurring_occurrences, ledger.transactions, ledger.recurring]);

  const prefs = ledger.recurring_prefs ?? {
    auto_detect: "on",
    auto_match: "auto",
    dismissed_keys: [],
  };

  const suggestionsBadgeCount =
    detectedPatterns.length + reconciliation.reviewCandidates.length;

  return (
    <>
      <section className="stats">
        <article className="stat net">
          <div className="stat-label">
            Monthly recurring expenses <Repeat size={17} />
          </div>
          <h2>{concealed(dashboard.monthly.estimated.expense)}</h2>
          <small>
            Paid {concealed(dashboard.monthly.confirmed.expense)}{" "}
            <span>
              Forecast {concealed(dashboard.monthly.unconfirmed.expense)}
            </span>
          </small>
          <div className="stat-decoration" />
        </article>
        <article className="stat">
          <div className="stat-label">
            Monthly recurring income{" "}
            <span className="round-icon green">
              <ArrowDownLeft size={19} />
            </span>
          </div>
          <h2>{concealed(dashboard.monthly.estimated.income)}</h2>
          <small>
            Received {concealed(dashboard.monthly.confirmed.income)}{" "}
            <span className="green-text">
              Forecast {concealed(dashboard.monthly.unconfirmed.income)}
            </span>
          </small>
        </article>
        <article className="stat">
          <div className="stat-label">
            Next 30 days due{" "}
            <span className="round-icon terracotta">
              <ArrowUpRight size={19} />
            </span>
          </div>
          <h2>{concealed(dashboard.upcoming30Days.expense)}</h2>
          <small>
            {dashboard.upcoming30Days.items.length} upcoming{" "}
            <span>
              {dashboard.overdueCount
                ? `${dashboard.overdueCount} overdue`
                : "Balances untouched until paid"}
            </span>
          </small>
        </article>
      </section>

      {/* Main Recurring Navigation Tabs */}
      <div className="recurring-top-nav">
        <div
          className="recurring-tabs"
          role="tablist"
          aria-label="Recurring views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "schedules"}
            className={`recurring-tab-btn ${activeTab === "schedules" ? "active" : ""}`}
            onClick={() => setActiveTab("schedules")}
          >
            <Repeat size={16} /> Schedules
            <span className="tab-count">{counts.all}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "suggestions"}
            className={`recurring-tab-btn ${activeTab === "suggestions" ? "active" : ""}`}
            onClick={() => setActiveTab("suggestions")}
          >
            <Sparkles size={16} /> Suggestions
            {suggestionsBadgeCount > 0 && (
              <span className="tab-count highlight">
                {suggestionsBadgeCount}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "upcoming"}
            className={`recurring-tab-btn ${activeTab === "upcoming" ? "active" : ""}`}
            onClick={() => setActiveTab("upcoming")}
          >
            <Calendar size={16} /> Upcoming
            <span className="tab-count">
              {forecast.horizons[30].unconfirmedCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "history"}
            className={`recurring-tab-btn ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            <ReceiptText size={16} /> History
            <span className="tab-count">{historyItems.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "insights"}
            className={`recurring-tab-btn ${activeTab === "insights" ? "active" : ""}`}
            onClick={() => setActiveTab("insights")}
          >
            <TrendingUp size={16} /> Insights
          </button>
        </div>

        <button
          type="button"
          className={`icon-button settings-toggle ${showSettings ? "active" : ""}`}
          aria-label="Automation preferences"
          title="Automation preferences"
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings size={17} />
        </button>
      </div>

      {/* Expandable Automation Preferences Bar */}
      {showSettings && (
        <section className="panel automation-settings-card">
          <div className="settings-head">
            <div className="settings-title">
              <Settings size={18} />
              <div>
                <b>Recurring Automation Preferences</b>
                <p>
                  Control intelligent pattern detection, automatic statement
                  matching, and dismissed items
                </p>
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close preferences"
              onClick={() => setShowSettings(false)}
            >
              <X size={17} />
            </button>
          </div>

          <div className="settings-grid">
            <div className="setting-item">
              <label htmlFor="pref-auto-detect">
                <b>Automatic pattern detection</b>
                <span className="muted">
                  Discovers recurring subscriptions, bills and salaries from
                  your history
                </span>
              </label>
              <select
                id="pref-auto-detect"
                value={prefs.auto_detect}
                disabled={busy}
                onChange={(e) =>
                  onUpdatePreferences?.({
                    auto_detect: e.target.value as AutoDetectSetting,
                  })
                }
              >
                <option value="on">On · detect recurring patterns</option>
                <option value="off">Off · do not detect patterns</option>
              </select>
            </div>

            <div className="setting-item">
              <label htmlFor="pref-auto-match">
                <b>Transaction reconciliation mode</b>
                <span className="muted">
                  How bank transactions and CSV imports match active schedules
                </span>
              </label>
              <select
                id="pref-auto-match"
                value={prefs.auto_match}
                disabled={busy}
                onChange={(e) =>
                  onUpdatePreferences?.({
                    auto_match: e.target.value as AutoMatchSetting,
                  })
                }
              >
                <option value="auto">
                  Auto · link high-confidence matches (≥88%)
                </option>
                <option value="review">
                  Review · require manual confirmation
                </option>
                <option value="off">Off · disable reconciliation</option>
              </select>
            </div>
          </div>

          <div className="settings-footer">
            <div className="dismissed-summary">
              <span>
                {prefs.dismissed_keys.length > 0
                  ? `${prefs.dismissed_keys.length} dismissed pattern${prefs.dismissed_keys.length > 1 ? "s or matches" : " or match"}`
                  : "No dismissed items"}
              </span>
              {prefs.dismissed_keys.length > 0 && onRestoreDismissed && (
                <button
                  type="button"
                  className="text-button small"
                  disabled={busy}
                  onClick={onRestoreDismissed}
                >
                  <RotateCcw size={13} /> Restore all dismissed
                </button>
              )}
            </div>
            {onRunReconciliation && (
              <button
                type="button"
                className="secondary compact-btn"
                disabled={busy || prefs.auto_match === "off"}
                onClick={onRunReconciliation}
              >
                <RefreshCw size={14} /> Reconcile transactions now
              </button>
            )}
          </div>
        </section>
      )}

      {/* TAB 1: SCHEDULES */}
      {activeTab === "schedules" && (
        <section className="panel section">
          <div className="panel-heading recurring-panel-head">
            <div>
              <h2>
                Recurring schedules{" "}
                <span className="count">{filteredSchedules.length}</span>
              </h2>
              <p>
                Subscriptions, bills and regular income. Balances update only
                when you confirm a payment.
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
                const { schedule, paymentStatus, nextDueDate, overdueDates } =
                  item;
                const category = ledger.categories.find(
                  (c) => c.id === schedule.category_id,
                );
                const account = ledger.accounts.find(
                  (a) => a.id === schedule.account_id,
                );
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
                          className={
                            schedule.type === "income" ? "green-text" : ""
                          }
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
                          onClick={() =>
                            onConfirmOccurrence(schedule, nextDueDate)
                          }
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
                        title={
                          schedule.status === "paused" ? "Resume" : "Pause"
                        }
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
      )}

      {/* TAB 2: SUGGESTIONS & RECONCILIATION REVIEW */}
      {activeTab === "suggestions" && (
        <section className="panel section suggestions-tab-content">
          <div className="panel-heading recurring-panel-head">
            <div>
              <h2>
                Recurring suggestions &amp; match reviews{" "}
                <span className="count">{suggestionsBadgeCount}</span>
              </h2>
              <p>
                Statistical pattern detection across your transaction history
                and bank imports. Nothing is scheduled or altered until you
                accept.
              </p>
            </div>
            {onRunReconciliation && (
              <button
                type="button"
                className="secondary compact-btn"
                disabled={busy}
                onClick={onRunReconciliation}
              >
                <RefreshCw size={14} /> Scan transactions
              </button>
            )}
          </div>

          {/* Ambiguous match candidates awaiting user confirmation */}
          {reconciliation.reviewCandidates.length > 0 && (
            <div className="review-candidates-block">
              <div className="sub-block-heading">
                <span className="eyebrow amber">MATCH CONFIRMATION NEEDED</span>
                <h3>
                  Transactions matching existing schedules (
                  {reconciliation.reviewCandidates.length})
                </h3>
                <p>
                  These transactions resemble your scheduled payments but had
                  slight amount/date variance or multiple possible matches.
                </p>
              </div>

              <div className="suggestion-cards-grid">
                {reconciliation.reviewCandidates.map((candidate) => {
                  return (
                    <article
                      className="suggestion-card review-card"
                      key={candidate.matchKey}
                    >
                      <div className="card-top">
                        <span className="card-kind-badge">
                          {candidate.schedule.type === "income" ? (
                            <ArrowDownLeft size={14} />
                          ) : (
                            <ReceiptText size={14} />
                          )}
                          Match Candidate
                        </span>
                        <span className="confidence-pill medium">
                          {Math.round(candidate.confidence * 100)}% match
                        </span>
                      </div>

                      <div className="card-main">
                        <h4>{candidate.schedule.name}</h4>
                        <p className="card-detail-line">
                          Scheduled for{" "}
                          <b>{formatShortDate(candidate.occurrenceDate)}</b> (
                          {money(candidate.schedule.amount)})
                        </p>

                        <div className="match-tx-preview">
                          <span className="preview-label">
                            Bank transaction:
                          </span>
                          <b>{candidate.transaction.payee}</b>
                          <span>
                            {formatShortDate(candidate.transaction.date)} ·{" "}
                            {money(candidate.transaction.amount)}
                          </span>
                        </div>

                        <div className="reasons-pill-row">
                          {candidate.reasons.map((r) => (
                            <span className="reason-tag" key={r}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="card-actions">
                        <button
                          type="button"
                          className="secondary compact-btn"
                          disabled={busy}
                          onClick={() =>
                            onDismissMatchCandidate?.(candidate.matchKey)
                          }
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          className="primary compact-btn"
                          disabled={busy}
                          onClick={() =>
                            onConfirmMatchCandidate?.(candidate)
                          }
                        >
                          <Check size={14} /> Confirm match
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unscheduled recurring patterns detected from history */}
          <div className="detected-patterns-block">
            <div className="sub-block-heading">
              <span className="eyebrow green">UNSCHEDULED RECURRING PATTERNS</span>
              <h3>
                Discovered from your history ({detectedPatterns.length})
              </h3>
              <p>
                Deterministic frequency analysis over your historical
                transactions and bank statements.
              </p>
            </div>

            {detectedPatterns.length ? (
              <div className="suggestion-cards-grid">
                {detectedPatterns.map((pattern) => {
                  const isExpanded = expandedPattern === pattern.patternKey;
                  const cat = ledger.categories.find(
                    (c) => c.id === pattern.categoryId,
                  );
                  const acc = ledger.accounts.find(
                    (a) => a.id === pattern.accountId,
                  );
                  return (
                    <article
                      className="suggestion-card"
                      key={pattern.patternKey}
                    >
                      <div className="card-top">
                        <span className="card-kind-badge">
                          <Sparkles size={14} />
                          {pattern.categoryHint}
                        </span>
                        <span
                          className={`confidence-pill ${pattern.confidenceTier}`}
                        >
                          {Math.round(pattern.confidence * 100)}%{" "}
                          {pattern.confidenceTier === "high"
                            ? "High"
                            : "Medium"}{" "}
                          confidence
                        </span>
                      </div>

                      <div className="card-main">
                        <div className="card-heading-row">
                          <div>
                            <h4>{pattern.displayName}</h4>
                            <p className="card-subtitle">
                              {frequencyLabels[pattern.frequency]} ·{" "}
                              {pattern.type} · {acc?.name ?? "Account"}{" "}
                              {cat ? `· ${cat.name}` : ""}
                            </p>
                          </div>
                          <div className="card-amount">
                            <b>
                              {pattern.amountType === "variable" ? "~" : ""}
                              {money(pattern.estimatedAmount)}
                            </b>
                            <small>
                              {pattern.amountType === "variable"
                                ? `Range ${money(pattern.minAmount)} – ${money(pattern.maxAmount)}`
                                : "Consistent amount"}
                            </small>
                          </div>
                        </div>

                        <div className="pattern-explanation-box">
                          <Info size={14} />
                          <span>{pattern.explanation}</span>
                        </div>

                        <div className="supporting-disclosure">
                          <button
                            type="button"
                            className="text-button small disclosure-btn"
                            onClick={() =>
                              setExpandedPattern(
                                isExpanded ? null : pattern.patternKey,
                              )
                            }
                          >
                            {isExpanded ? "Hide" : "View"}{" "}
                            {pattern.supportingTransactions.length} supporting
                            transactions
                            <ChevronDown
                              size={14}
                              style={{
                                transform: isExpanded
                                  ? "rotate(180deg)"
                                  : "none",
                              }}
                            />
                          </button>

                          {isExpanded && (
                            <div className="supporting-list">
                              {pattern.supportingTransactions.map((tx) => (
                                <div
                                  className="supporting-row"
                                  key={tx.id}
                                >
                                  <span>{formatShortDate(tx.date)}</span>
                                  <span className="supporting-payee">
                                    {tx.payee}
                                  </span>
                                  <b>{money(tx.amount)}</b>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="card-actions">
                        <button
                          type="button"
                          className="secondary compact-btn"
                          disabled={busy}
                          onClick={() =>
                            onDismissPattern?.(pattern.patternKey)
                          }
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          className="secondary compact-btn"
                          disabled={busy}
                          onClick={() => onEditPattern?.(pattern)}
                        >
                          <Pencil size={13} /> Edit &amp; create
                        </button>
                        <button
                          type="button"
                          className="primary compact-btn"
                          disabled={busy}
                          onClick={() => onAcceptPattern?.(pattern)}
                        >
                          <Check size={14} /> Accept &amp; schedule
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty">
                <Check size={28} />
                <h3>All caught up</h3>
                <p>
                  No unscheduled recurring patterns detected in your recent
                  transactions. As you record transactions or import bank
                  statements, new patterns will appear here.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 3: UPCOMING FORECAST & CALENDAR */}
      {activeTab === "upcoming" && (
        <section className="panel section">
          <div className="panel-heading recurring-panel-head">
            <div>
              <h2>Intelligent upcoming forecast</h2>
              <p>
                {upcomingView === "timeline"
                  ? `Chronological schedule and predicted clearing dates for the next ${horizonDays} days`
                  : "Monthly calendar view of recurring occurrences"}
              </p>
            </div>
            <div className="recurring-head-actions">
              {upcomingView === "timeline" && (
                <div
                  className="status-tabs"
                  role="tablist"
                  aria-label="Forecast horizon"
                >
                  {([30, 60, 90] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      role="tab"
                      aria-selected={horizonDays === h}
                      className={horizonDays === h ? "active" : ""}
                      onClick={() => setHorizonDays(h)}
                    >
                      {h} days
                    </button>
                  ))}
                </div>
              )}
              <div
                className="status-tabs"
                role="tablist"
                aria-label="Upcoming view mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={upcomingView === "timeline"}
                  className={upcomingView === "timeline" ? "active" : ""}
                  onClick={() => setUpcomingView("timeline")}
                >
                  <List size={15} /> Chronological
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={upcomingView === "calendar"}
                  className={upcomingView === "calendar" ? "active" : ""}
                  onClick={() => setUpcomingView("calendar")}
                >
                  <Calendar size={15} /> Calendar
                </button>
              </div>
            </div>
          </div>

          {upcomingView === "timeline" ? (
            upcomingFilteredItems.length ? (
              <div className="transaction-list">
                {upcomingFilteredItems.map((item: ForecastItem) => {
                  const account = ledger.accounts.find(
                    (a) => a.id === item.schedule.account_id,
                  );
                  return (
                    <div
                      className="transaction-row recurring-occ-row"
                      key={`${item.schedule.id}:${item.scheduledDate}`}
                    >
                      <div className="transaction-main as-static">
                        <span
                          className={`transaction-icon ${item.schedule.type}`}
                        >
                          {item.status === "paid" ? (
                            <Check size={18} />
                          ) : item.schedule.type === "income" ? (
                            <ArrowDownLeft size={18} />
                          ) : (
                            <ReceiptText size={18} />
                          )}
                        </span>
                        <span className="transaction-description">
                          <b className="recurring-title-line">
                            <span>{item.schedule.name}</span>
                            <span className={`status-pill ${item.status}`}>
                              {statusLabels[item.status]}
                            </span>
                            {item.schedule.amount_type === "variable" &&
                              !item.isConfirmed && (
                                <span className="mini-tag variable">
                                  Variable
                                </span>
                              )}
                          </b>
                          <small>
                            Scheduled {formatFullDate(item.scheduledDate)}
                            {item.offsetDays !== 0 && !item.isConfirmed && (
                              <span className="predicted-hint">
                                {" "}
                                · Predicted {formatShortDate(item.predictedDate)}{" "}
                                ({item.offsetDays > 0 ? `+${item.offsetDays}d` : `${item.offsetDays}d`})
                              </span>
                            )}
                            {" "}· {account?.name ?? "Account"}
                            {" "}· {item.explanation}
                          </small>
                        </span>
                        <span className="transaction-value">
                          <b
                            className={
                              item.schedule.type === "income"
                                ? "green-text"
                                : ""
                            }
                          >
                            {item.hasRange ? "~" : ""}
                            {item.schedule.type === "income" ? "+" : "−"}
                            {concealed(item.expectedAmount)}
                          </b>
                          <small>
                            {item.hasRange
                              ? `Range ${concealed(item.lowAmount)} – ${concealed(item.highAmount)}`
                              : item.isConfirmed
                                ? "Recorded"
                                : "Expected"}
                          </small>
                        </span>
                      </div>
                      <div className="recurring-actions">
                        {item.isConfirmed && item.confirmation ? (
                          <button
                            type="button"
                            className="icon-button"
                            disabled={busy}
                            title="Unlink confirmation"
                            aria-label={`Unlink ${item.schedule.name} on ${item.scheduledDate}`}
                            onClick={() =>
                              onUnlinkOccurrence(item.confirmation!.id)
                            }
                          >
                            <Unlink size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary compact-btn"
                            disabled={busy}
                            onClick={() =>
                              onConfirmOccurrence(
                                item.schedule,
                                item.scheduledDate,
                              )
                            }
                          >
                            Mark paid
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty">
                <Calendar size={28} />
                <h3>No payments in the next {horizonDays} days</h3>
                <p>
                  Active schedules with upcoming payments in this window will
                  appear here.
                </p>
              </div>
            )
          ) : (
            <div className="recurring-calendar-wrap">
              <div className="calendar-toolbar">
                <div className="month-control">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Previous calendar month"
                    onClick={() => setCalMonth((m) => shiftMonth(m, -1))}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>{formatMonthYear(calMonth)}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Next calendar month"
                    onClick={() => setCalMonth((m) => shiftMonth(m, 1))}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
                <span className="muted small">
                  {calendarData.items.length} scheduled in month
                </span>
              </div>
              <div className="calendar-grid">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div className="calendar-weekday" key={d}>
                    {d}
                  </div>
                ))}
                {calendarData.cells.map((cell, idx) =>
                  cell ? (
                    <div
                      key={cell.date}
                      className={`calendar-cell ${cell.date === asOf ? "today" : ""}`}
                    >
                      <span className="calendar-day">{cell.day}</span>
                      <div className="calendar-events">
                        {cell.items.map((ev) => (
                          <button
                            key={`${ev.schedule.id}:${ev.date}`}
                            type="button"
                            disabled={busy}
                            className={`calendar-chip ${ev.status} ${ev.schedule.type}`}
                            title={`${ev.schedule.name} · ${concealed(ev.linkedTransaction?.amount ?? ev.schedule.amount)} (${statusLabels[ev.status]}${ev.confirmation ? " — click to unlink" : ""})`}
                            onClick={() => {
                              if (ev.confirmation) {
                                if (
                                  window.confirm(
                                    `Unlink confirmation for ${ev.schedule.name} on ${formatFullDate(ev.date)}? The recorded ledger transaction will remain untouched.`,
                                  )
                                ) {
                                  onUnlinkOccurrence(ev.confirmation.id);
                                }
                              } else {
                                onConfirmOccurrence(ev.schedule, ev.date);
                              }
                            }}
                          >
                            <span>{ev.schedule.name}</span>
                            <b>
                              {concealed(
                                ev.linkedTransaction?.amount ??
                                  ev.schedule.amount,
                              )}
                            </b>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="calendar-cell empty-cell"
                      key={`pad-${idx}`}
                    />
                  ),
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 4: HISTORY */}
      {activeTab === "history" && (
        <section className="panel section">
          <div className="panel-heading recurring-panel-head">
            <div>
              <h2>
                Occurrence history{" "}
                <span className="count">{historyItems.length}</span>
              </h2>
              <p>
                Confirmed occurrences linked to actual ledger transactions.
                Unlinking or re-linking never deletes or alters transaction
                amounts.
              </p>
            </div>
          </div>

          {historyItems.length ? (
            <div className="transaction-list">
              {historyItems.map(({ occ, tx, schedule }) => {
                const isAutoMatched = occ.match_source === "auto";
                return (
                  <div
                    className="transaction-row recurring-occ-row history-row"
                    key={occ.id}
                  >
                    <div className="transaction-main as-static">
                      <span
                        className={`transaction-icon ${schedule?.type ?? "expense"}`}
                      >
                        <Check size={18} />
                      </span>
                      <span className="transaction-description">
                        <b className="recurring-title-line">
                          <span>
                            {schedule?.name ?? "Recurring payment"}
                          </span>
                          <span
                            className={`match-source-badge ${isAutoMatched ? "auto" : "manual"}`}
                            title={occ.match_reason ?? undefined}
                          >
                            {isAutoMatched ? (
                              <>
                                <Sparkles size={12} /> Auto-matched
                              </>
                            ) : (
                              <>
                                <Check size={12} /> Manual
                              </>
                            )}
                          </span>
                        </b>
                        <small>
                          Scheduled {formatFullDate(occ.occurrence_date)}
                          {tx ? (
                            <>
                              {" "}· Linked to <b>"{tx.payee || "Transaction"}"</b>{" "}
                              on {formatShortDate(tx.date)}
                            </>
                          ) : (
                            " · Linked transaction not found"
                          )}
                          {occ.match_reason && (
                            <span className="match-reason-caption">
                              {" "}· {occ.match_reason}
                            </span>
                          )}
                        </small>
                      </span>
                      <span className="transaction-value">
                        <b
                          className={
                            schedule?.type === "income" ? "green-text" : ""
                          }
                        >
                          {schedule?.type === "income" ? "+" : "−"}
                          {concealed(tx?.amount ?? schedule?.amount ?? 0)}
                        </b>
                        <small>Recorded in ledger</small>
                      </span>
                    </div>

                    <div className="recurring-actions">
                      {schedule && (
                        <button
                          type="button"
                          className="secondary compact-btn"
                          disabled={busy}
                          title="Change linked transaction"
                          onClick={() =>
                            onRelinkOccurrence?.(
                              occ,
                              schedule,
                              occ.occurrence_date,
                            )
                          }
                        >
                          Change
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        title="Unlink confirmation"
                        aria-label={`Unlink ${schedule?.name ?? "payment"} on ${occ.occurrence_date}`}
                        onClick={() => onUnlinkOccurrence(occ.id)}
                      >
                        <Unlink size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">
              <ReceiptText size={28} />
              <h3>No confirmed occurrences yet</h3>
              <p>
                When you mark recurring payments as paid or auto-reconciliation
                matches bank transactions, they will be listed here.
              </p>
            </div>
          )}
        </section>
      )}

      {/* TAB 5: INSIGHTS & CASH FLOW PROJECTIONS */}
      {activeTab === "insights" && (
        <div className="recurring-insights-grid">
          <section className="panel section">
            <div className="panel-heading">
              <div>
                <h2>30, 60 &amp; 90-day cash flow horizons</h2>
                <p>
                  Scheduled and predicted recurring payments. Confirmed payments
                  are already recorded and never counted twice.
                </p>
              </div>
            </div>

            <div className="horizon-cards-row">
              {([30, 60, 90] as const).map((h) => {
                const hz = forecast.horizons[h];
                return (
                  <div className="horizon-card" key={h}>
                    <div className="horizon-head">
                      <b>Next {h} days</b>
                      <span>
                        {formatShortDate(hz.fromDate)} –{" "}
                        {formatShortDate(hz.toDate)}
                      </span>
                    </div>

                    <div className="horizon-metrics">
                      <div className="horizon-metric">
                        <span className="muted">Expected expenses</span>
                        <strong>−{concealed(hz.expense.expected)}</strong>
                        {hz.expense.low !== hz.expense.high && (
                          <small>
                            Range {concealed(hz.expense.low)} –{" "}
                            {concealed(hz.expense.high)}
                          </small>
                        )}
                      </div>
                      <div className="horizon-metric">
                        <span className="muted">Expected income</span>
                        <strong className="green-text">
                          +{concealed(hz.income.expected)}
                        </strong>
                        {hz.income.low !== hz.income.high && (
                          <small>
                            Range {concealed(hz.income.low)} –{" "}
                            {concealed(hz.income.high)}
                          </small>
                        )}
                      </div>
                      <div className="horizon-metric net">
                        <span className="muted">Net recurring</span>
                        <strong
                          className={hz.net.expected >= 0 ? "green-text" : ""}
                        >
                          {hz.net.expected >= 0 ? "+" : "−"}
                          {concealed(Math.abs(hz.net.expected))}
                        </strong>
                        <small>
                          {hz.unconfirmedCount} payment
                          {hz.unconfirmedCount > 1 ? "s" : ""} expected
                        </small>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel section">
            <div className="panel-heading">
              <div>
                <h2>Projected account balances</h2>
                <p>
                  Current ledger balances adjusted for scheduled payments.
                  Recorded balances stay untouched until you confirm.
                </p>
              </div>
            </div>

            <div className="projected-table-wrap">
              <table className="projected-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Current balance</th>
                    <th>Scheduled 30d delta</th>
                    <th>Projected (30d)</th>
                    <th>Projected (60d)</th>
                    <th>Projected (90d)</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.accountProjections.map((ap) => {
                    return (
                      <tr key={ap.account.id}>
                        <td>
                          <b>{ap.account.name}</b>
                        </td>
                        <td>{concealed(ap.currentBalance)}</td>
                        <td>
                          <span
                            className={
                              ap.horizons[30].scheduledDelta >= 0
                                ? "green-text"
                                : ""
                            }
                          >
                            {ap.horizons[30].scheduledDelta >= 0 ? "+" : "−"}
                            {concealed(
                              Math.abs(ap.horizons[30].scheduledDelta),
                            )}
                          </span>
                        </td>
                        <td>
                          <b
                            className={
                              ap.horizons[30].projectedBalance < 0
                                ? "red-text"
                                : ""
                            }
                          >
                            {concealed(ap.horizons[30].projectedBalance)}
                          </b>
                          {ap.horizons[30].hasRange && (
                            <small className="cell-sub">
                              ({concealed(ap.horizons[30].lowBalance)} –{" "}
                              {concealed(ap.horizons[30].highBalance)})
                            </small>
                          )}
                        </td>
                        <td>
                          <b
                            className={
                              ap.horizons[60].projectedBalance < 0
                                ? "red-text"
                                : ""
                            }
                          >
                            {concealed(ap.horizons[60].projectedBalance)}
                          </b>
                        </td>
                        <td>
                          <b
                            className={
                              ap.horizons[90].projectedBalance < 0
                                ? "red-text"
                                : ""
                            }
                          >
                            {concealed(ap.horizons[90].projectedBalance)}
                          </b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel section monthly-commitment-panel">
            <div className="panel-heading">
              <div>
                <h2>Monthly recurring commitment breakdown</h2>
                <p>
                  Analysis of fixed commitments vs variable estimated bills
                </p>
              </div>
            </div>

            <div className="commitments-breakdown-row">
              <div className="commitment-stat-box">
                <span className="muted">Fixed expenses / mo</span>
                <strong>
                  {concealed(forecast.monthlyCommitment.fixedExpense)}
                </strong>
                <small>Subscriptions, rent &amp; contracts</small>
              </div>
              <div className="commitment-stat-box">
                <span className="muted">Variable expenses / mo</span>
                <strong>
                  {concealed(forecast.monthlyCommitment.variableExpense)}
                </strong>
                <small>Estimated utilities &amp; fluctuating bills</small>
              </div>
              <div className="commitment-stat-box">
                <span className="muted">Total recurring expenses / mo</span>
                <strong>
                  {concealed(forecast.monthlyCommitment.totalExpense)}
                </strong>
                <small>Combined monthly commitment</small>
              </div>
              <div className="commitment-stat-box">
                <span className="muted">Annualized recurring expenses</span>
                <strong>
                  {concealed(forecast.monthlyCommitment.annualizedExpense)}
                </strong>
                <small>12-month recurring expenditure</small>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function RecurringEditorModal({
  item,
  initialDraft,
  ledger,
  concealed,
  busy,
  onClose,
  onSave,
  onUnlinkOccurrence,
}: {
  item?: RecurringSchedule;
  initialDraft?: Partial<Omit<RecurringSchedule, "id">>;
  ledger: Ledger;
  concealed: (v: number) => string;
  busy: boolean;
  onClose: () => void;
  onSave: (
    value: Omit<RecurringSchedule, "id">,
    id?: string,
  ) => Promise<void>;
  onUnlinkOccurrence: (occurrenceId: string) => void;
}) {
  const [kind, setKind] = useState<RecurringKind>(
    item?.type ?? initialDraft?.type ?? "expense",
  );
  const [amountType, setAmountType] = useState<RecurringAmountType>(
    item?.amount_type ?? initialDraft?.amount_type ?? "fixed",
  );
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  const confirmedLinks = useMemo(
    () =>
      item
        ? (ledger.recurring_occurrences ?? [])
            .filter((o) => o.recurring_id === item.id)
            .slice()
            .sort((a, b) => b.occurrence_date.localeCompare(a.occurrence_date))
        : [],
    [item, ledger.recurring_occurrences],
  );
  const hasConfirmed = confirmedLinks.length > 0;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    try {
      const value: Omit<RecurringSchedule, "id"> = {
        name: s("name"),
        type: kind,
        amount: minor(s("amount")),
        amount_type: amountType,
        account_id: s("account_id"),
        category_id: s("category_id") || null,
        frequency: s("frequency") as RecurringFrequency,
        start_date: s("start_date"),
        end_date: s("end_date") || null,
        status: (s("status") || item?.status || initialDraft?.status || "active") as RecurringStatus,
        notes: s("notes"),
      };
      validateRecurringSchedule({ ...value, id: item?.id }, ledger);
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
      aria-labelledby="recurring-modal-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">RECURRING SCHEDULE</span>
          <h2 id="recurring-modal-title">
            {item ? "Edit" : "Add"} recurring
          </h2>
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
        {ledger.accounts.length === 0 && (
          <div className="notice">
            Create an account first before adding a recurring schedule.
          </div>
        )}
        <div className="type-switch">
          {(["expense", "income"] as const).map((k) => (
            <button
              type="button"
              key={k}
              disabled={hasConfirmed && k !== item?.type}
              className={kind === k ? "selected" : ""}
              onClick={() => setKind(k)}
            >
              {k === "expense" ? (
                <ArrowUpRight size={16} />
              ) : (
                <ArrowDownLeft size={16} />
              )}{" "}
              {k}
            </button>
          ))}
        </div>

        <label>
          Name
          <input
            name="name"
            required
            autoFocus
            maxLength={160}
            defaultValue={item?.name ?? initialDraft?.name ?? ""}
            placeholder={
              kind === "income"
                ? "e.g. Monthly salary, Rental income"
                : "e.g. DEWA, du Fibre, Netflix, Rent"
            }
          />
        </label>

        <div className="form-row">
          <label>
            {amountType === "variable" ? "Expected amount" : "Amount"}{" "}
            <span className="muted">AED</span>
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={
                item
                  ? (item.amount / 100).toFixed(2)
                  : initialDraft?.amount !== undefined
                    ? (initialDraft.amount / 100).toFixed(2)
                    : ""
              }
            />
          </label>
          <label>
            Amount behaviour
            <select
              name="amount_type"
              value={amountType}
              onChange={(e) =>
                setAmountType(e.target.value as RecurringAmountType)
              }
            >
              <option value="fixed">Fixed amount</option>
              <option value="variable">Variable (prompt when paid)</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Account
            <select
              name="account_id"
              required
              defaultValue={
                item?.account_id ??
                initialDraft?.account_id ??
                ledger.accounts[0]?.id
              }
            >
              {ledger.accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              name="category_id"
              defaultValue={
                item?.category_id ?? initialDraft?.category_id ?? ""
              }
            >
              <option value="">Uncategorized</option>
              {ledger.categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Frequency
            <select
              name="frequency"
              defaultValue={
                item?.frequency ?? initialDraft?.frequency ?? "monthly"
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label>
            Status
            <select
              name="status"
              defaultValue={item?.status ?? initialDraft?.status ?? "active"}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Start date
            <input
              name="start_date"
              type="date"
              required
              min={MIN_RECURRING_DATE}
              max={MAX_RECURRING_DATE}
              defaultValue={
                item?.start_date ?? initialDraft?.start_date ?? today()
              }
            />
          </label>
          <label>
            End date <span className="muted">Optional</span>
            <input
              name="end_date"
              type="date"
              min={MIN_RECURRING_DATE}
              max={MAX_RECURRING_DATE}
              defaultValue={item?.end_date ?? initialDraft?.end_date ?? ""}
            />
          </label>
        </div>

        <label>
          Notes <span className="muted">Optional</span>
          <textarea
            name="notes"
            maxLength={1000}
            defaultValue={item?.notes ?? initialDraft?.notes ?? ""}
            placeholder="Contract details, billing day or reminders"
          />
        </label>

        {hasConfirmed && (
          <div className="link-existing-box">
            <span className="eyebrow">
              CONFIRMED OCCURRENCES ({confirmedLinks.length})
            </span>
            <div className="candidate-list">
              {confirmedLinks.map((occ) => {
                const tx = ledger.transactions.find(
                  (t) => t.id === occ.transaction_id,
                );
                return (
                  <div className="candidate-item as-row" key={occ.id}>
                    <span className="candidate-meta">
                      <b>{formatFullDate(occ.occurrence_date)}</b>
                      <small>
                        {tx
                          ? `${tx.payee || "Transaction"} · ${concealed(tx.amount)}`
                          : "Linked transaction"}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="secondary compact-btn"
                      disabled={busy}
                      onClick={() => onUnlinkOccurrence(occ.id)}
                    >
                      <Unlink size={13} /> Unlink
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="form-hint">
          Month-end, quarterly and leap-day schedules adjust automatically.
          Account balances only change when you mark an occurrence paid.
        </p>

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
          <button
            className="primary"
            disabled={busy || !ledger.accounts.length}
          >
            {busy ? "Saving…" : item ? "Save changes" : "Add recurring"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function ConfirmOccurrenceModal({
  schedule,
  occurrenceDate,
  ledger,
  busy,
  existingConfirmation,
  onClose,
  onConfirmCreate,
  onConfirmLink,
}: {
  schedule: RecurringSchedule;
  occurrenceDate: string;
  ledger: Ledger;
  busy: boolean;
  existingConfirmation?: RecurringOccurrenceRecord;
  onClose: () => void;
  onConfirmCreate: (
    schedule: RecurringSchedule,
    occurrenceDate: string,
    tx: Omit<Transaction, "id">,
  ) => Promise<void>;
  onConfirmLink: (
    schedule: RecurringSchedule,
    occurrenceDate: string,
    transactionId: string,
    existingConfirmationId?: string,
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"create" | "link">(
    existingConfirmation ? "link" : "create",
  );
  const [selectedTxId, setSelectedTxId] = useState(
    existingConfirmation?.transaction_id ?? "",
  );
  const [linkSearch, setLinkSearch] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const linkedIds = useMemo(
    () =>
      new Set(
        (ledger.recurring_occurrences ?? [])
          .filter((o) => o.id !== existingConfirmation?.id)
          .map((o) => o.transaction_id),
      ),
    [ledger.recurring_occurrences, existingConfirmation],
  );

  const candidates = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    const targetMs = Date.parse(occurrenceDate + "T00:00:00Z");
    return ledger.transactions
      .filter((t) => {
        if (t.type !== schedule.type) return false;
        if (linkedIds.has(t.id)) return false;
        if (q) {
          const acc =
            ledger.accounts.find((a) => a.id === t.account_id)?.name ?? "";
          if (
            !`${t.payee} ${t.notes} ${t.date} ${acc}`
              .toLowerCase()
              .includes(q)
          )
            return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = Math.abs(Date.parse(a.date + "T00:00:00Z") - targetMs);
        const db = Math.abs(Date.parse(b.date + "T00:00:00Z") - targetMs);
        return da - db || b.date.localeCompare(a.date);
      });
  }, [
    ledger.transactions,
    ledger.accounts,
    schedule.type,
    linkedIds,
    linkSearch,
    occurrenceDate,
  ]);

  const defaultAccount = ledger.accounts.find(
    (a) => a.id === schedule.account_id,
  );
  const defaultTxDate =
    defaultAccount && occurrenceDate < defaultAccount.opening_date
      ? defaultAccount.opening_date
      : occurrenceDate;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "link") {
        validateOccurrenceConfirmation(
          {
            id: existingConfirmation?.id,
            recurring_id: schedule.id,
            occurrence_date: occurrenceDate,
            transaction_id: selectedTxId,
          },
          ledger,
        );
        await onConfirmLink(
          schedule,
          occurrenceDate,
          selectedTxId,
          existingConfirmation?.id,
        );
      } else {
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "").trim();
        const rawAmount = s("amount");
        if (!rawAmount)
          throw new Error(
            schedule.amount_type === "variable"
              ? "Enter the actual amount paid for this variable payment."
              : "Enter the amount paid.",
          );
        const tx = buildConfirmTransaction(schedule, occurrenceDate, ledger, {
          amount: minor(rawAmount),
          account_id: s("account_id"),
          category_id: s("category_id") || null,
          date: s("date"),
          payee: s("payee") || schedule.name,
          notes: s("notes"),
        });
        await onConfirmCreate(schedule, occurrenceDate, tx);
      }
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.includes("Link existing")) {
        setMode("link");
      }
      setError(msg);
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
      aria-labelledby="confirm-recurring-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">
            {existingConfirmation
              ? "CHANGE LINKED TRANSACTION"
              : `CONFIRM PAYMENT · ${formatFullDate(occurrenceDate).toUpperCase()}`}
          </span>
          <h2 id="confirm-recurring-title">{schedule.name}</h2>
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
        <div className="type-switch">
          {!existingConfirmation && (
            <button
              type="button"
              className={mode === "create" ? "selected" : ""}
              onClick={() => {
                setMode("create");
                setError("");
              }}
            >
              <Plus size={16} /> Record new transaction
            </button>
          )}
          <button
            type="button"
            className={mode === "link" ? "selected" : ""}
            onClick={() => {
              setMode("link");
              setError("");
            }}
          >
            <Link2 size={16} /> Link existing ({candidates.length})
          </button>
        </div>

        {mode === "create" ? (
          <>
            {schedule.amount_type === "variable" && (
              <div className="notice">
                Variable payment (expected {money(schedule.amount)}). Enter the
                actual {schedule.type === "income" ? "received" : "paid"} amount
                in AED below.
              </div>
            )}
            <label>
              Actual amount <span className="muted">AED</span>
              <input
                name="amount"
                required
                autoFocus
                inputMode="decimal"
                placeholder={
                  schedule.amount_type === "variable"
                    ? `Expected ${(schedule.amount / 100).toFixed(2)}`
                    : "0.00"
                }
                defaultValue={
                  schedule.amount_type === "fixed"
                    ? (schedule.amount / 100).toFixed(2)
                    : ""
                }
              />
            </label>
            <div className="form-row">
              <label>
                Account
                <select
                  name="account_id"
                  required
                  defaultValue={schedule.account_id}
                >
                  {ledger.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  name="category_id"
                  defaultValue={schedule.category_id ?? ""}
                >
                  <option value="">Uncategorized</option>
                  {ledger.categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Transaction date
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={defaultTxDate}
                />
              </label>
              <label>
                Payee / description
                <input
                  name="payee"
                  maxLength={160}
                  defaultValue={schedule.name}
                />
              </label>
            </div>
            <label>
              Notes <span className="muted">Optional</span>
              <textarea
                name="notes"
                maxLength={1000}
                defaultValue={schedule.notes}
              />
            </label>
          </>
        ) : (
          <div className="link-existing-box">
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search existing transactions to link"
                placeholder="Filter unlinked transactions…"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
              />
            </label>
            {candidates.length ? (
              <div className="candidate-list">
                {candidates.slice(0, 30).map((t) => {
                  const account = ledger.accounts.find(
                    (a) => a.id === t.account_id,
                  );
                  return (
                    <label className="candidate-item" key={t.id}>
                      <input
                        type="radio"
                        name="transaction_id"
                        value={t.id}
                        checked={selectedTxId === t.id}
                        onChange={() => setSelectedTxId(t.id)}
                      />
                      <span className="candidate-meta">
                        <b>{t.payee || "Transaction"}</b>
                        <small>
                          {formatFullDate(t.date)} ·{" "}
                          {account?.name ?? "Account"}
                        </small>
                      </span>
                      <strong
                        className={t.type === "income" ? "green-text" : ""}
                      >
                        {t.type === "income" ? "+" : "−"}
                        {money(t.amount)}
                      </strong>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="form-hint">
                No unlinked {schedule.type} transactions found.
              </p>
            )}
            <p className="form-hint">
              Linking attaches this occurrence to an existing ledger record
              without creating a duplicate transaction or changing account
              balances.
            </p>
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
          <button
            className="primary"
            disabled={busy || (mode === "link" && !selectedTxId)}
          >
            {busy
              ? "Saving…"
              : mode === "link"
                ? existingConfirmation
                  ? "Update link"
                  : "Link transaction"
                : "Confirm & record"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
