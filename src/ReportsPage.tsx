import { Download, Tags } from "lucide-react";
import { budgetReport } from "./budgets";
import { BudgetReportPanel, monthLabel } from "./BudgetsView";
import { today, type Ledger } from "./domain";
import { downloadBlob, reportToCsv } from "./export";
import type { SpendingItem } from "./OverviewPage";
import { Empty } from "./TransactionList";

export function ReportsPage({
  ledger,
  budgetRangeStart,
  month,
  view,
  rangeLabel,
  summary,
  spending,
  concealed,
  onManageBudgets,
}: {
  ledger: Ledger;
  budgetRangeStart: string;
  month: string;
  view: string;
  rangeLabel: string;
  summary: { income: number; expense: number };
  spending: SpendingItem[];
  concealed: (v: number) => string;
  onManageBudgets: () => void;
}) {
  return (
    <>
      <BudgetReportPanel
        ledger={ledger}
        startMonth={budgetRangeStart}
        endMonth={month}
        rangeLabel={
          view === "all"
            ? `Every budgeted month through ${monthLabel(month)}`
            : rangeLabel
        }
        concealed={concealed}
        onManage={onManageBudgets}
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>Where it went</h2>
          <span>{rangeLabel}</span>
        </div>
        <div className="filters">
          <b>Income {concealed(summary.income)}</b>
          <b>Expenses {concealed(summary.expense)}</b>
          <b>Net cash flow {concealed(summary.income - summary.expense)}</b>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const report = budgetReport(ledger, budgetRangeStart, month);
              const csv = reportToCsv({
                rangeLabel,
                summary,
                spending,
                budgetReport: report,
              });
              downloadBlob(
                csv,
                `fuloos-report-${today()}.csv`,
                "text/csv;charset=utf-8",
              );
            }}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
        {spending.map((c) => (
          <div className="category-item" key={c.id}>
            <span className="category-symbol" style={{ color: c.color }}>
              <Tags size={20} />
            </span>
            <div>
              <b>{c.name}</b>
              <p>{((c.total / summary.expense) * 100).toFixed(1)}% of spending</p>
              <progress
                aria-label={`${c.name} share of spending`}
                value={c.total}
                max={summary.expense}
              />
            </div>
            <strong>{concealed(c.total)}</strong>
          </div>
        ))}
        {!spending.length && (
          <Empty
            title="No spending in this period"
            text="Choose another date range to explore your spending."
          />
        )}
      </section>
    </>
  );
}
