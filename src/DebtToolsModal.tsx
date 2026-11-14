import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Flame, Snowflake, X } from "lucide-react";
import {
  simulateDebtPayoff,
  type DebtInput,
  type PayoffStrategy,
} from "./debtTools";
import { balance, minor, type Ledger } from "./domain";

interface EditableDebtRow {
  id: string;
  name: string;
  source: "credit_card" | "liability";
  balanceFils: number;
  aprText: string;
  minPayText: string;
  included: boolean;
}

function formatMonths(months: number): string {
  if (months <= 0) return "0 months";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months} ${months === 1 ? "month" : "months"}`;
  if (rem === 0) return `${years} ${years === 1 ? "yr" : "yrs"}`;
  return `${years} ${years === 1 ? "yr" : "yrs"} ${rem} mo`;
}

function safeMinor(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  try {
    const val = minor(trimmed);
    return val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

function safeAprBps(text: string): number {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100000, Math.round(n * 100));
}

export function DebtToolsModal({
  ledger,
  concealed,
  onClose,
}: {
  ledger: Ledger;
  concealed: (v: number) => string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const [rows, setRows] = useState<EditableDebtRow[]>(() => {
    const list: EditableDebtRow[] = [];
    for (const acc of ledger.accounts) {
      if (acc.type !== "credit_card") continue;
      const bal = balance(acc, ledger.transactions);
      if (bal >= 0) continue;
      list.push({
        id: acc.id,
        name: acc.name,
        source: "credit_card",
        balanceFils: -bal,
        aprText: acc.apr_bps ? (acc.apr_bps / 100).toFixed(2) : "0",
        minPayText: acc.minimum_payment
          ? (acc.minimum_payment / 100).toFixed(2)
          : "0.00",
        included: true,
      });
    }
    for (const item of ledger.net_worth_items ?? []) {
      if (item.kind !== "liability" || item.current_value <= 0) continue;
      list.push({
        id: item.id,
        name: item.name,
        source: "liability",
        balanceFils: item.current_value,
        aprText: "0",
        minPayText: "0.00",
        included: true,
      });
    }
    return list;
  });

  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");
  const [extraText, setExtraText] = useState("500.00");

  const extraFils = useMemo(() => safeMinor(extraText), [extraText]);

  const activeDebts = useMemo<DebtInput[]>(() => {
    return rows
      .filter((r) => r.included && r.balanceFils > 0)
      .map((r) => ({
        id: r.id,
        name: r.name,
        balanceFils: r.balanceFils,
        aprBps: safeAprBps(r.aprText),
        minimumPaymentFils: safeMinor(r.minPayText),
        source: r.source,
      }));
  }, [rows]);

  const totalDebtFils = useMemo(
    () => activeDebts.reduce((sum, d) => sum + d.balanceFils, 0),
    [activeDebts],
  );

  const avalancheResult = useMemo(
    () => simulateDebtPayoff(activeDebts, extraFils, "avalanche"),
    [activeDebts, extraFils],
  );
  const snowballResult = useMemo(
    () => simulateDebtPayoff(activeDebts, extraFils, "snowball"),
    [activeDebts, extraFils],
  );
  const baselineResult = useMemo(
    () => simulateDebtPayoff(activeDebts, 0, strategy),
    [activeDebts, strategy],
  );

  const activeResult =
    strategy === "avalanche" ? avalancheResult : snowballResult;
  const otherResult =
    strategy === "avalanche" ? snowballResult : avalancheResult;

  const interestSavedVsBaseline = Math.max(
    0,
    baselineResult.totalInterestFils - activeResult.totalInterestFils,
  );
  const interestDiffVsOther =
    otherResult.totalInterestFils - activeResult.totalInterestFils;

  const previewRows = useMemo(() => {
    const sched = activeResult.schedulePreview;
    if (sched.length <= 12) return sched;
    return [...sched.slice(0, 11), sched[sched.length - 1]];
  }, [activeResult.schedulePreview]);

  return (
    <dialog
      ref={dialog}
      className="modal debt-tools-modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="debt-planner-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">DEBT PAYOFF PLANNER</span>
          <h2 id="debt-planner-title">Payoff simulator</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>

      <div className="debt-planner-body">
        {rows.length === 0 ? (
          <div className="notice">
            No credit card balances or net worth liabilities with positive debt
            were found. Add a negative balance on a credit card or a liability in
            Net Worth to model payoff scenarios.
          </div>
        ) : (
          <>
            <div className="debt-controls-bar">
              <div className="debt-strategy-toggle" role="group" aria-label="Payoff strategy">
                <button
                  type="button"
                  className={strategy === "avalanche" ? "selected" : ""}
                  onClick={() => setStrategy("avalanche")}
                >
                  <Flame size={15} /> Avalanche (highest APR)
                </button>
                <button
                  type="button"
                  className={strategy === "snowball" ? "selected" : ""}
                  onClick={() => setStrategy("snowball")}
                >
                  <Snowflake size={15} /> Snowball (smallest balance)
                </button>
              </div>
              <label className="debt-extra-field">
                <span>Extra monthly payment (AED)</span>
                <input
                  inputMode="decimal"
                  value={extraText}
                  onChange={(e) => setExtraText(e.target.value)}
                  placeholder="0.00"
                />
              </label>
            </div>

            <div className="debt-inputs-table-wrap">
              <table className="debt-table">
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>Debt</th>
                    <th className="num">Balance</th>
                    <th className="num">APR (%)</th>
                    <th className="num">Min payment (AED)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.included ? "" : "is-excluded"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.included}
                          aria-label={`Include ${r.name}`}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((item) =>
                                item.id === r.id
                                  ? { ...item, included: e.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <div className="debt-name-cell">
                          <b>{r.name}</b>
                          <small className="muted">
                            {r.source === "credit_card"
                              ? "Credit card"
                              : "Liability"}
                          </small>
                        </div>
                      </td>
                      <td className="num">{concealed(r.balanceFils)}</td>
                      <td className="num">
                        <input
                          className="debt-inline-input"
                          inputMode="decimal"
                          aria-label={`${r.name} APR percent`}
                          value={r.aprText}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((item) =>
                                item.id === r.id
                                  ? { ...item, aprText: e.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="num">
                        <input
                          className="debt-inline-input"
                          inputMode="decimal"
                          aria-label={`${r.name} minimum payment`}
                          value={r.minPayText}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((item) =>
                                item.id === r.id
                                  ? { ...item, minPayText: e.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {activeDebts.length > 0 && (
              <>
                <div className="debt-summary-grid">
                  <div className="debt-stat-card">
                    <span>Total selected debt</span>
                    <strong>{concealed(totalDebtFils)}</strong>
                  </div>
                  <div className="debt-stat-card">
                    <span>Time to debt-free</span>
                    <strong>
                      {activeResult.paidOff
                        ? formatMonths(activeResult.months)
                        : `${activeResult.months}+ mos`}
                    </strong>
                  </div>
                  <div className="debt-stat-card">
                    <span>Total interest</span>
                    <strong>{concealed(activeResult.totalInterestFils)}</strong>
                  </div>
                  <div className="debt-stat-card">
                    <span>Total paid</span>
                    <strong>{concealed(activeResult.totalPaidFils)}</strong>
                  </div>
                </div>

                {(extraFils > 0 && interestSavedVsBaseline > 0) ||
                interestDiffVsOther !== 0 ? (
                  <div className="debt-callout">
                    <Calculator size={16} />
                    <div>
                      {extraFils > 0 && interestSavedVsBaseline > 0 && (
                        <span>
                          Adding {concealed(extraFils)}/mo saves{" "}
                          <b>{concealed(interestSavedVsBaseline)}</b> in interest
                          {baselineResult.paidOff && activeResult.paidOff
                            ? ` and ${formatMonths(Math.max(0, baselineResult.months - activeResult.months))} vs minimums only`
                            : ""}
                          .{" "}
                        </span>
                      )}
                      {interestDiffVsOther > 0 && (
                        <span>
                          {strategy === "avalanche" ? "Avalanche" : "Snowball"}{" "}
                          saves <b>{concealed(interestDiffVsOther)}</b> in
                          interest compared to{" "}
                          {strategy === "avalanche" ? "Snowball" : "Avalanche"}.
                        </span>
                      )}
                      {interestDiffVsOther < 0 && (
                        <span>
                          {strategy === "avalanche" ? "Snowball" : "Avalanche"}{" "}
                          costs <b>{concealed(-interestDiffVsOther)}</b> more in
                          interest than{" "}
                          {strategy === "avalanche" ? "Snowball" : "Avalanche"}.
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                {!activeResult.paidOff && (
                  <div className="notice">
                    With the current minimum payments and extra payment,{" "}
                    {concealed(activeResult.remainingDebtFils)} remains after{" "}
                    {activeResult.months} months. Increase your monthly payment
                    to pay off the balance.
                  </div>
                )}

                {activeResult.payoffOrder.length > 0 && (
                  <div className="debt-payoff-order">
                    <span className="field-label">Payoff order</span>
                    <div className="debt-order-chips">
                      {activeResult.payoffOrder.map((ev, idx) => (
                        <span className="debt-order-chip" key={ev.id}>
                          <b>#{idx + 1}</b> {ev.name} · Month {ev.month}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {previewRows.length > 0 && (
                  <div className="debt-schedule-wrap">
                    <span className="field-label">Schedule preview</span>
                    <table className="debt-table compact">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="num">Payment</th>
                          <th className="num">Interest</th>
                          <th className="num">Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((pt, idx) => {
                          const isJump =
                            activeResult.schedulePreview.length > 12 &&
                            idx === previewRows.length - 1;
                          return (
                            <tr key={pt.month}>
                              <td>
                                {isJump ? `… Month ${pt.month}` : `Month ${pt.month}`}
                              </td>
                              <td className="num">{concealed(pt.paidFils)}</td>
                              <td className="num">
                                {concealed(pt.interestFils)}
                              </td>
                              <td className="num">
                                {concealed(pt.totalBalanceFils)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
