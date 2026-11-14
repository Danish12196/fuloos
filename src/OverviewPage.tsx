import { useMemo } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Eye,
  EyeOff,
  Plus,
  Tags,
  Wallet,
} from "lucide-react";
import {
  balance,
  type Account,
  type Ledger,
  type SavingsGoal,
  type Transaction,
} from "./domain";
import { ACCOUNT_TYPES, type EditorModalState } from "./EditorModal";
import { DashboardGoals } from "./GoalsView";
import { DashboardNetWorth } from "./NetWorthView";
import { DashboardRecurring, type RecurringTab } from "./RecurringView";
import { Empty, TransactionList } from "./TransactionList";
import { useLocale } from "./i18n";

export interface SpendingItem {
  id: string;
  name: string;
  description: string;
  color: string;
  total: number;
}

export function OverviewPage({
  ledger,
  net,
  summary,
  rangeLabel,
  hidden,
  setHidden,
  concealed,
  spending,
  monthly,
  month,
  busy,
  onNavigate,
  onSelectAccount,
  onOpenModal,
  onOpenRecurring,
  onConfirmOccurrence,
  onAddGoal,
  onContributeGoal,
}: {
  ledger: Ledger;
  net: number;
  summary: { income: number; expense: number };
  rangeLabel: string;
  hidden: boolean;
  setHidden: (v: boolean) => void;
  concealed: (v: number) => string;
  spending: SpendingItem[];
  monthly: Transaction[];
  month: string;
  busy: boolean;
  onNavigate: (
    page:
      | "Overview"
      | "Transactions"
      | "Accounts"
      | "Reports"
      | "Recurring"
      | "Goals"
      | "Net Worth",
  ) => void;
  onSelectAccount: (accountId: string) => void;
  onOpenModal: (modal: EditorModalState) => void;
  onOpenRecurring: (
    tab?: RecurringTab,
    filter?: "all" | "active" | "overdue" | "paused",
  ) => void;
  onConfirmOccurrence: (
    schedule: NonNullable<Ledger["recurring"]>[number],
    occurrenceDate: string,
  ) => void;
  onAddGoal: () => void;
  onContributeGoal: (goal: SavingsGoal) => void;
}) {
  const donutGradient = useMemo(() => {
    if (summary.expense <= 0 || !spending.length) return "";
    let acc = 0;
    const stops = spending.map((c) => {
      const startPct = (acc / summary.expense) * 100;
      acc += c.total;
      const endPct = (acc / summary.expense) * 100;
      return `${c.color} ${startPct}% ${endPct}%`;
    });
    return `conic-gradient(${stops.join(",")})`;
  }, [spending, summary.expense]);

  const recentItems = useMemo(
    () =>
      monthly
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5),
    [monthly],
  );

  const { t } = useLocale();

  return (
    <>
      <section className="stats">
        <article className="stat net">
          <div className="stat-label">
            {t("overview.totalNetBalance")}{" "}
            <button
              className="icon-button"
              aria-label={
                hidden ? t("overview.showBalances") : t("overview.hideBalances")
              }
              onClick={() => setHidden(!hidden)}
            >
              {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <h2>{concealed(net)}</h2>
          <small>
            {t("overview.acrossAccounts", { count: ledger.accounts.length })}{" "}
            <span>{t("overview.includingCredit")}</span>
          </small>
          <div className="stat-decoration" />
        </article>
        <article className="stat">
          <div className="stat-label">
            {t("overview.income")}{" "}
            <span className="round-icon green">
              <ArrowDownLeft size={19} />
            </span>
          </div>
          <h2>{concealed(summary.income)}</h2>
          <small>
            {t("overview.moneyComingIn")}{" "}
            <span className="green-text">{rangeLabel}</span>
          </small>
        </article>
        <article className="stat">
          <div className="stat-label">
            {t("overview.expenses")}{" "}
            <span className="round-icon terracotta">
              <ArrowUpRight size={19} />
            </span>
          </div>
          <h2>{concealed(summary.expense)}</h2>
          <small>
            {t("overview.moneyGoingOut")} <span>{rangeLabel}</span>
          </small>
        </article>
      </section>
      <section className="section">
        <div className="section-title">
          <h2>
            {t("overview.yourAccounts")}{" "}
            <span className="count">{ledger.accounts.length}</span>
          </h2>
          <button
            className="text-button"
            onClick={() => onNavigate("Accounts")}
          >
            {t("overview.viewAllAccounts")}{" "}
            <ArrowRight size={15} className="rtl-flip" />
          </button>
        </div>
        <div className="account-grid">
          {ledger.accounts.slice(0, 3).map((a: Account) => (
            <button
              className="account-card"
              key={a.id}
              onClick={() => {
                onSelectAccount(a.id);
                onNavigate("Transactions");
              }}
            >
              <div className="account-top">
                <span
                  className="account-symbol"
                  style={{ background: a.color + "18", color: a.color }}
                >
                  {a.emoji || <Wallet size={20} />}
                </span>
                <span className="account-kind">{ACCOUNT_TYPES[a.type]}</span>
              </div>
              <h3>{a.name}</h3>
              <div className="account-bottom">
                <strong>{concealed(balance(a, ledger.transactions))}</strong>
                <span>AED</span>
              </div>
            </button>
          ))}
          <button
            className="add-account-card"
            onClick={() => onOpenModal({ kind: "account" })}
          >
            <span>
              <Plus size={21} />
            </span>
            <b>{t("overview.addAnAccount")}</b>
            <small>{t("overview.bringMoneyTogether")}</small>
          </button>
        </div>
      </section>
      <div className="overview-bottom">
        <section className="panel spending">
          <div className="panel-heading">
            <div>
              <button
                className="text-button"
                onClick={() => onNavigate("Reports")}
              >
                <h2>{t("overview.whereItWent")}</h2>
                <ArrowRight size={16} className="rtl-flip" />
              </button>
              <p>{t("overview.spendingByCategory")}</p>
            </div>
            <Tags size={18} className="muted" />
          </div>
          {summary.expense > 0 ? (
            <>
              <div className="donut" style={{ background: donutGradient }}>
                <div>
                  <small>{t("overview.totalSpent")}</small>
                  <b>{concealed(summary.expense)}</b>
                </div>
              </div>
              <div className="category-legend">
                {spending.map((c) => (
                  <div key={c.id}>
                    <span
                      className="color-dot"
                      style={{ background: c.color }}
                    />
                    <span>{c.name}</span>
                    <b>{concealed(c.total)}</b>
                    <small>
                      {Math.round((c.total / summary.expense) * 100)}%
                    </small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty
              title={t("overview.noSpendingTitle")}
              text={t("overview.noSpendingText")}
            />
          )}
        </section>
        <section className="panel recent">
          <div className="panel-heading">
            <div>
              <h2>{t("overview.recentActivity")}</h2>
              <p>{t("overview.recentSubtitle")}</p>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("Transactions")}
            >
              {t("overview.viewAll")}{" "}
              <ArrowRight size={15} className="rtl-flip" />
            </button>
          </div>
          <TransactionList
            items={recentItems}
            ledger={ledger}
            concealed={concealed}
            onEdit={(t) => onOpenModal({ kind: "transaction", item: t })}
          />
        </section>
      </div>
      <DashboardRecurring
        ledger={ledger}
        month={month}
        concealed={concealed}
        busy={busy}
        onOpenRecurring={onOpenRecurring}
        onConfirm={onConfirmOccurrence}
      />
      <DashboardGoals
        ledger={ledger}
        concealed={concealed}
        onOpenGoals={() => onNavigate("Goals")}
        onAddGoal={onAddGoal}
        onContributeGoal={onContributeGoal}
      />
      <DashboardNetWorth
        ledger={ledger}
        concealed={concealed}
        onOpenNetWorth={() => onNavigate("Net Worth")}
      />
    </>
  );
}
