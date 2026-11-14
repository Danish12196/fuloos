import { useMemo, useState } from "react";
import { Download, Printer, Tags } from "lucide-react";
import { budgetReport } from "./budgets";
import { BudgetReportPanel, monthLabel } from "./BudgetsView";
import { today, type Ledger } from "./domain";
import { downloadBlob, reportToCsv } from "./export";
import type { SpendingItem } from "./OverviewPage";
import { isPeriodSpan, shortMonthName } from "./period";
import {
  computeCategoryTrends,
  computePayeeBreakdown,
  computeSavingsRate,
  computeYoYComparison,
  periodRangeFromSpan,
  type PeriodRange,
} from "./reportsAnalytics";
import { Empty } from "./TransactionList";
import "./styles/reports-analytics.css";

function formatShortMonth(ym: string): string {
  const idx = Number(ym.slice(5, 7)) - 1;
  return `${shortMonthName(idx)} ${ym.slice(2, 4)}`;
}

function formatRangeShort(range: PeriodRange): string {
  if (!range.firstMonth) return "All time";
  if (range.firstMonth === range.lastMonth) return monthLabel(range.lastMonth);
  return `${formatShortMonth(range.firstMonth)} – ${formatShortMonth(range.lastMonth)}`;
}

function formatPctChange(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function formatDeltaPts(pts: number | null): string {
  if (pts === null) return "—";
  const sign = pts > 0 ? "+" : pts < 0 ? "−" : "";
  return `${sign}${Math.abs(pts).toFixed(1)} pts`;
}

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
  const [payeeKind, setPayeeKind] = useState<"expense" | "income">("expense");

  const span = isPeriodSpan(view) ? view : "month";
  const periodRange = useMemo(
    () => periodRangeFromSpan(span, month, budgetRangeStart),
    [span, month, budgetRangeStart],
  );

  const netCashFlow = summary.income - summary.expense;
  const savingsRatePct = computeSavingsRate(summary.income, summary.expense);

  const yoy = useMemo(
    () => computeYoYComparison(ledger.transactions, periodRange),
    [ledger.transactions, periodRange],
  );

  const payees = useMemo(
    () =>
      computePayeeBreakdown(ledger.transactions, periodRange, {
        kind: payeeKind,
        limit: 10,
      }),
    [ledger.transactions, periodRange, payeeKind],
  );

  const trends = useMemo(
    () =>
      computeCategoryTrends(ledger.transactions, ledger.categories, month, {
        monthsCount: 6,
        topCategories: 5,
      }),
    [ledger.transactions, ledger.categories, month],
  );

  const formatSignedMoney = (v: number) => {
    if (v === 0) return concealed(0);
    return `${v > 0 ? "+" : "−"}${concealed(Math.abs(v))}`;
  };

  return (
    <>
      <div className="print-report-header">
        <h1>Fuloos Financial Report</h1>
        <span>{rangeLabel}</span>
      </div>

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
          <div className="reports-actions">
            <span>{rangeLabel}</span>
            <button
              type="button"
              className="secondary no-print"
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
            <button
              type="button"
              className="secondary no-print"
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print / Save PDF
            </button>
          </div>
        </div>

        <div className="reports-kpis">
          <div className="reports-kpi">
            <span className="reports-kpi-label">Income</span>
            <span className="reports-kpi-value">{concealed(summary.income)}</span>
          </div>
          <div className="reports-kpi">
            <span className="reports-kpi-label">Expenses</span>
            <span className="reports-kpi-value">{concealed(summary.expense)}</span>
          </div>
          <div className="reports-kpi">
            <span className="reports-kpi-label">Net cash flow</span>
            <span
              className={`reports-kpi-value ${netCashFlow > 0 ? "is-positive" : netCashFlow < 0 ? "is-negative" : ""}`}
            >
              {concealed(netCashFlow)}
            </span>
          </div>
          <div className="reports-kpi">
            <span className="reports-kpi-label">Savings rate</span>
            <span
              className={`reports-kpi-value ${savingsRatePct !== null && savingsRatePct > 0 ? "is-positive" : savingsRatePct !== null && savingsRatePct < 0 ? "is-negative" : ""}`}
            >
              {savingsRatePct !== null ? `${savingsRatePct.toFixed(1)}%` : "—"}
            </span>
          </div>
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

      <section className="panel">
        <div className="panel-heading">
          <h2>Year-over-year comparison</h2>
          <span>
            {yoy.available && yoy.priorRange
              ? `${rangeLabel} vs ${formatRangeShort(yoy.priorRange)}`
              : rangeLabel}
          </span>
        </div>
        {!yoy.available || !yoy.prior || !yoy.delta ? (
          <p className="reports-note">
            Year-over-year comparison is available for specific periods (Month,
            YTD, 12M, or Custom).
          </p>
        ) : (
          <>
            {!yoy.hasPriorData && (
              <p className="reports-note">
                No transactions recorded in the prior-year period (
                {formatRangeShort(yoy.priorRange!)}).
              </p>
            )}
            <div className="reports-table-wrap">
              <table className="reports-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className="num">Current</th>
                    <th className="num">Prior year</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Income</td>
                    <td className="num">{concealed(yoy.current.income)}</td>
                    <td className="num">{concealed(yoy.prior.income)}</td>
                    <td className="num">
                      <span
                        className={`reports-delta ${yoy.delta.income.delta > 0 ? "is-good" : yoy.delta.income.delta < 0 ? "is-bad" : ""}`}
                      >
                        {formatSignedMoney(yoy.delta.income.delta)}
                      </span>
                      <span
                        className={`reports-pct-pill ${yoy.delta.income.pctChange !== null && yoy.delta.income.pctChange > 0 ? "is-good" : yoy.delta.income.pctChange !== null && yoy.delta.income.pctChange < 0 ? "is-bad" : ""}`}
                      >
                        {formatPctChange(yoy.delta.income.pctChange)}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>Expenses</td>
                    <td className="num">{concealed(yoy.current.expenses)}</td>
                    <td className="num">{concealed(yoy.prior.expenses)}</td>
                    <td className="num">
                      <span
                        className={`reports-delta ${yoy.delta.expenses.delta < 0 ? "is-good" : yoy.delta.expenses.delta > 0 ? "is-bad" : ""}`}
                      >
                        {formatSignedMoney(yoy.delta.expenses.delta)}
                      </span>
                      <span
                        className={`reports-pct-pill ${yoy.delta.expenses.pctChange !== null && yoy.delta.expenses.pctChange < 0 ? "is-good" : yoy.delta.expenses.pctChange !== null && yoy.delta.expenses.pctChange > 0 ? "is-bad" : ""}`}
                      >
                        {formatPctChange(yoy.delta.expenses.pctChange)}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>Net</td>
                    <td className="num">{concealed(yoy.current.net)}</td>
                    <td className="num">{concealed(yoy.prior.net)}</td>
                    <td className="num">
                      <span
                        className={`reports-delta ${yoy.delta.net.delta > 0 ? "is-good" : yoy.delta.net.delta < 0 ? "is-bad" : ""}`}
                      >
                        {formatSignedMoney(yoy.delta.net.delta)}
                      </span>
                      <span
                        className={`reports-pct-pill ${yoy.delta.net.pctChange !== null && yoy.delta.net.pctChange > 0 ? "is-good" : yoy.delta.net.pctChange !== null && yoy.delta.net.pctChange < 0 ? "is-bad" : ""}`}
                      >
                        {formatPctChange(yoy.delta.net.pctChange)}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>Savings rate</td>
                    <td className="num">
                      {yoy.current.savingsRatePct !== null
                        ? `${yoy.current.savingsRatePct.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="num">
                      {yoy.prior.savingsRatePct !== null
                        ? `${yoy.prior.savingsRatePct.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="num">
                      <span
                        className={`reports-delta ${yoy.delta.savingsRatePts !== null && yoy.delta.savingsRatePts > 0 ? "is-good" : yoy.delta.savingsRatePts !== null && yoy.delta.savingsRatePts < 0 ? "is-bad" : ""}`}
                      >
                        {formatDeltaPts(yoy.delta.savingsRatePts)}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Top merchants & payees</h2>
          <div className="reports-actions">
            <div
              className="reports-toggle no-print"
              role="group"
              aria-label="Payee breakdown type"
            >
              <button
                type="button"
                className={payeeKind === "expense" ? "is-active" : ""}
                onClick={() => setPayeeKind("expense")}
              >
                Expenses
              </button>
              <button
                type="button"
                className={payeeKind === "income" ? "is-active" : ""}
                onClick={() => setPayeeKind("income")}
              >
                Income
              </button>
            </div>
          </div>
        </div>
        {payees.items.length > 0 ? (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Payee</th>
                  <th className="num">Txns</th>
                  <th className="num">Average</th>
                  <th className="num">Total</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {payees.items.map((item) => (
                  <tr key={item.payee}>
                    <td>{item.payee}</td>
                    <td className="num">{item.count}</td>
                    <td className="num">{concealed(item.averageFils)}</td>
                    <td className="num">
                      <strong>{concealed(item.totalFils)}</strong>
                    </td>
                    <td className="num">
                      <span className="reports-share-cell">
                        <span className="reports-share-track" aria-hidden>
                          <span
                            className="reports-share-fill"
                            style={{
                              width: `${Math.min(100, Math.max(2, item.sharePct))}%`,
                            }}
                          />
                        </span>
                        <span>{item.sharePct.toFixed(1)}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={`No ${payeeKind} payees in this period`}
            text="Try switching between expenses and income or selecting another period."
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Category trends</h2>
          <span>
            {formatShortMonth(trends.months[0])} –{" "}
            {formatShortMonth(trends.months[trends.months.length - 1])}
          </span>
        </div>
        {trends.categories.length > 0 ? (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Category</th>
                  {trends.months.map((m) => (
                    <th className="num" key={m}>
                      {formatShortMonth(m)}
                    </th>
                  ))}
                  <th className="num">6M Total</th>
                </tr>
              </thead>
              <tbody>
                {trends.categories.map((cat) => (
                  <tr key={cat.categoryId}>
                    <td>
                      <span className="reports-cat-name">
                        <span
                          className="reports-cat-dot"
                          style={{ background: cat.color }}
                          aria-hidden
                        />
                        {cat.name}
                      </span>
                    </td>
                    {cat.monthlyFils.map((val, idx) => {
                      const pct =
                        trends.maxFils > 0 ? (val / trends.maxFils) * 100 : 0;
                      return (
                        <td className="num" key={trends.months[idx]}>
                          <div className="reports-trend-cell">
                            <span>{val > 0 ? concealed(val) : "—"}</span>
                            <span className="reports-trend-track" aria-hidden>
                              <span
                                className="reports-trend-fill"
                                style={{
                                  width: `${val > 0 ? Math.max(4, pct) : 0}%`,
                                  background: cat.color,
                                }}
                              />
                            </span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="num">
                      <strong>{concealed(cat.totalFils)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>All expenses</td>
                  {trends.monthTotals.map((total, idx) => (
                    <td className="num" key={trends.months[idx]}>
                      {total > 0 ? concealed(total) : "—"}
                    </td>
                  ))}
                  <td className="num">
                    {concealed(
                      trends.monthTotals.reduce((sum, v) => sum + v, 0),
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty
            title="No expense trends yet"
            text="Record expenses over time to see monthly category trends."
          />
        )}
      </section>
    </>
  );
}

