import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  ReceiptText,
  RefreshCw,
  Repeat,
  RotateCcw,
  Settings,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import {
  today,
  type AutoDetectSetting,
  type AutoMatchSetting,
  type Ledger,
  type RecurringFrequency,
  type RecurringOccurrenceRecord,
  type RecurringPreferences,
  type RecurringSchedule,
} from "./domain.ts";
import {
  dashboardRecurringSummary,
  type SchedulePaymentStatus,
} from "./recurring.ts";
import {
  buildIntelligentForecast,
  detectRecurringPatterns,
  reconcileTransactions,
  type DetectedPattern,
  type IntelligentForecast,
  type MatchCandidate,
} from "./recurringAutomation.ts";
import { RecurringSchedulesTab } from "./RecurringSchedulesTab";
import { RecurringSuggestionsTab } from "./RecurringSuggestionsTab";
import { RecurringUpcomingTab } from "./RecurringUpcomingTab";
import { RecurringHistoryTab } from "./RecurringHistoryTab";
import { RecurringInsightsTab } from "./RecurringInsightsTab";
export {
  ConfirmOccurrenceModal,
  RecurringEditorModal,
} from "./RecurringModals";

export const categoryHintLabels: Record<string, string> = {
  subscription: "Subscription",
  utilities: "Utilities",
  telecom: "Phone & internet",
  rent: "Rent",
  salary: "Salary",
  insurance: "Insurance",
  membership: "Membership",
  loan: "Loan / instalment",
  other_recurring: "Recurring",
};

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
  completed: "Ended",
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
    () =>
      detectRecurringPatterns(ledger, { asOfDate: asOf, includeEnded: false }),
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
  const [showSettings, setShowSettings] = useState(false);

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

  const prefs = ledger.recurring_prefs ?? {
    auto_detect: "on",
    auto_match: "auto",
    dismissed_keys: [],
  };

  const activePatternCount = useMemo(
    () => detectedPatterns.filter((p) => p.status === "active").length,
    [detectedPatterns],
  );

  const suggestionsBadgeCount =
    activePatternCount + reconciliation.reviewCandidates.length;

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
            <span className="tab-count">{(ledger.recurring ?? []).length}</span>
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
            <span className="tab-count">
              {(ledger.recurring_occurrences ?? []).length}
            </span>
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

      {activeTab === "schedules" && (
        <RecurringSchedulesTab
          ledger={ledger}
          asOf={asOf}
          forecast={forecast}
          concealed={concealed}
          busy={busy}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          onAddSchedule={onAddSchedule}
          onEditSchedule={onEditSchedule}
          onTogglePause={onTogglePause}
          onDeleteSchedule={onDeleteSchedule}
          onConfirmOccurrence={onConfirmOccurrence}
        />
      )}

      {activeTab === "suggestions" && (
        <RecurringSuggestionsTab
          ledger={ledger}
          detectedPatterns={detectedPatterns}
          reconciliation={reconciliation}
          suggestionsBadgeCount={suggestionsBadgeCount}
          busy={busy}
          onAcceptPattern={onAcceptPattern}
          onEditPattern={onEditPattern}
          onDismissPattern={onDismissPattern}
          onConfirmMatchCandidate={onConfirmMatchCandidate}
          onDismissMatchCandidate={onDismissMatchCandidate}
          onRunReconciliation={onRunReconciliation}
        />
      )}

      {activeTab === "upcoming" && (
        <RecurringUpcomingTab
          ledger={ledger}
          asOf={asOf}
          forecast={forecast}
          concealed={concealed}
          busy={busy}
          onConfirmOccurrence={onConfirmOccurrence}
          onUnlinkOccurrence={onUnlinkOccurrence}
        />
      )}

      {activeTab === "history" && (
        <RecurringHistoryTab
          ledger={ledger}
          concealed={concealed}
          busy={busy}
          onUnlinkOccurrence={onUnlinkOccurrence}
          onRelinkOccurrence={onRelinkOccurrence}
        />
      )}

      {activeTab === "insights" && (
        <RecurringInsightsTab forecast={forecast} concealed={concealed} />
      )}
    </>
  );
}
