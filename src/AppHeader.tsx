import { ArrowRight, Plus } from "lucide-react";
import type { Session } from "./client";
import { today } from "./domain";
import { PeriodPicker } from "./PeriodPicker";
import { periodDates, type PeriodSpan } from "./period";
import { ThemeToggle } from "./ThemeToggle";

export function AppTopbar({
  page,
  demo,
  session,
  onOpenSettings,
}: {
  page: string;
  demo: boolean;
  session: Session | null;
  onOpenSettings: () => void;
}) {
  return (
    <header className="topbar">
      <span>
        Personal finance <span className="slash">/</span> <b>{page}</b>
      </span>
      <div className="topbar-right">
        <ThemeToggle />
        <span className="currency-pill">
          AED <span>United Arab Emirates</span>
        </span>
        <button
          type="button"
          className="small-avatar"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          {demo ? "D" : session?.user.email?.slice(0, 1).toUpperCase()}
        </button>
      </div>
    </header>
  );
}

export function AppPageHeader({
  page,
  demo,
  loading,
  busy,
  error,
  month,
  rangeFrom,
  span,
  activeMonths,
  onExitDemo,
  onPrimaryAction,
  onRetry,
  onPeriodChange,
}: {
  page: string;
  demo: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  month: string;
  rangeFrom: string;
  span: PeriodSpan;
  activeMonths: Set<string>;
  onExitDemo: () => void;
  onPrimaryAction: () => void;
  onRetry: () => void;
  onPeriodChange: (next: {
    span: PeriodSpan;
    month: string;
    from?: string;
  }) => void;
}) {
  return (
    <>
      {demo && (
        <div className="demo-banner">
          <span>
            You're exploring a sample workspace. Changes last until you leave.
          </span>
          <button onClick={onExitDemo}>
            Sign in to save <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR MONEY, IN VIEW</div>
          <h1>{page === "Overview" ? "A clearer picture." : page}</h1>
          <p>
            {page === "Overview"
              ? "Your everyday finances, all in one calm place."
              : page === "Recurring"
                ? "Subscriptions, bills and regular income — balances stay untouched until paid."
                : page === "Budgets"
                  ? "Monthly limits per category, and how your spending measures up."
                  : page === "Goals"
                    ? "Savings goals and sinking funds, tracked at your own pace."
                    : page === "Net Worth"
                      ? "Cash, investments, gold, property, and liabilities in one view."
                      : page === "Accounts"
                        ? "Every account. One place to see where you stand."
                        : page === "Categories"
                          ? "Organize your money in a way that makes sense to you."
                          : "The small details behind the bigger picture."}
          </p>
        </div>
        <button
          className="primary"
          disabled={loading || busy}
          onClick={onPrimaryAction}
        >
          <Plus size={18} />
          {page === "Accounts"
            ? "Add account"
            : page === "Categories"
              ? "Add category"
              : page === "Recurring"
                ? "Add recurring"
                : page === "Budgets"
                  ? "Add budget"
                  : page === "Goals"
                    ? "Add goal"
                    : page === "Net Worth"
                      ? "Add item"
                      : "Add transaction"}
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error} <button onClick={onRetry}>Retry</button>
        </div>
      )}
      {loading && (
        <div className="loading-inline" role="status">
          Loading your workspace…
        </div>
      )}
      {(page === "Overview" ||
        page === "Transactions" ||
        page === "Reports") && (
        <div className="period-row">
          <PeriodPicker
            label="Date range"
            month={month}
            from={rangeFrom}
            span={span}
            spans={["month", "custom", "ytd", "12", "all"]}
            currentMonth={today().slice(0, 7)}
            activeMonths={activeMonths}
            onChange={onPeriodChange}
          />
          <span className="muted">{periodDates(span, month, rangeFrom)}</span>
        </div>
      )}
    </>
  );
}
