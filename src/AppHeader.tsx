import { ArrowRight, Plus } from "lucide-react";
import type { Session } from "./client";
import { today } from "./domain";
import { useLocale, type TranslationKey } from "./i18n";
import { LanguageToggle } from "./LanguageToggle";
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
  const { t } = useLocale();
  return (
    <header className="topbar">
      <span>
        {t("topbar.breadcrumb")} <span className="slash">/</span>{" "}
        <b>{t(`nav.${page}` as TranslationKey)}</b>
      </span>
      <div className="topbar-right">
        <LanguageToggle />
        <ThemeToggle />
        <span className="currency-pill">
          AED <span>{t("topbar.country")}</span>
        </span>
        <button
          type="button"
          className="small-avatar"
          aria-label={t("common.settings")}
          title={t("common.settings")}
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
  const { t } = useLocale();
  const title =
    page === "Overview"
      ? t("header.title.Overview")
      : t(`nav.${page}` as TranslationKey);
  const subtitle = t(`header.subtitle.${page}` as TranslationKey);
  const primaryActionLabel =
    page === "Accounts"
      ? t("action.addAccount")
      : page === "Categories"
        ? t("action.addCategory")
        : page === "Recurring"
          ? t("action.addRecurring")
          : page === "Budgets"
            ? t("action.addBudget")
            : page === "Goals"
              ? t("action.addGoal")
              : page === "Net Worth"
                ? t("action.addItem")
                : t("action.addTransaction");
  return (
    <>
      {demo && (
        <div className="demo-banner">
          <span>{t("demo.banner")}</span>
          <button onClick={onExitDemo}>
            {t("demo.signInToSave")} <ArrowRight size={14} className="rtl-flip" />
          </button>
        </div>
      )}
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("header.eyebrow")}</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <button
          className="primary"
          disabled={loading || busy}
          onClick={onPrimaryAction}
        >
          <Plus size={18} />
          {primaryActionLabel}
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error} <button onClick={onRetry}>{t("common.retry")}</button>
        </div>
      )}
      {loading && (
        <div className="loading-inline" role="status">
          {t("common.loadingWorkspace")}
        </div>
      )}
      {(page === "Overview" ||
        page === "Transactions" ||
        page === "Reports") && (
        <div className="period-row">
          <PeriodPicker
            label={t("common.dateRange")}
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
