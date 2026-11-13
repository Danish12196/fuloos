import type { IntelligentForecast } from "./recurringAutomation.ts";
import { formatShortDate } from "./RecurringView";

export function RecurringInsightsTab({
  forecast,
  concealed,
}: {
  forecast: IntelligentForecast;
  concealed: (v: number) => string;
}) {
  return (
    <div className="recurring-insights-grid">
      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h2>30, 60 &amp; 90-day cash flow horizons</h2>
            <p>
              Scheduled and predicted recurring payments. Confirmed payments are
              already recorded and never counted twice.
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
                      {hz.unconfirmedCount === 1 ? "" : "s"} expected
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
              Current ledger balances adjusted for scheduled payments. Recorded
              balances stay untouched until you confirm.
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
              {forecast.accountProjections.map((ap) => (
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
                      {concealed(Math.abs(ap.horizons[30].scheduledDelta))}
                    </span>
                  </td>
                  <td>
                    <b
                      className={
                        ap.horizons[30].projectedBalance < 0 ? "red-text" : ""
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
                        ap.horizons[60].projectedBalance < 0 ? "red-text" : ""
                      }
                    >
                      {concealed(ap.horizons[60].projectedBalance)}
                    </b>
                  </td>
                  <td>
                    <b
                      className={
                        ap.horizons[90].projectedBalance < 0 ? "red-text" : ""
                      }
                    >
                      {concealed(ap.horizons[90].projectedBalance)}
                    </b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel section monthly-commitment-panel">
        <div className="panel-heading">
          <div>
            <h2>Monthly recurring commitment breakdown</h2>
            <p>Analysis of fixed commitments vs variable estimated bills</p>
          </div>
        </div>

        <div className="commitments-breakdown-row">
          <div className="commitment-stat-box">
            <span className="muted">Fixed expenses / mo</span>
            <strong>{concealed(forecast.monthlyCommitment.fixedExpense)}</strong>
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
            <strong>{concealed(forecast.monthlyCommitment.totalExpense)}</strong>
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
  );
}
