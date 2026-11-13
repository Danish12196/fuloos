import { useMemo } from "react";
import { Check, ReceiptText, Sparkles, Unlink } from "lucide-react";
import type {
  Ledger,
  RecurringOccurrenceRecord,
  RecurringSchedule,
} from "./domain.ts";
import { formatFullDate, formatShortDate } from "./RecurringView";

export function RecurringHistoryTab({
  ledger,
  concealed,
  busy,
  onUnlinkOccurrence,
  onRelinkOccurrence,
}: {
  ledger: Ledger;
  concealed: (v: number) => string;
  busy: boolean;
  onUnlinkOccurrence: (occurrenceId: string) => void;
  onRelinkOccurrence?: (
    existing: RecurringOccurrenceRecord,
    s: RecurringSchedule,
    date: string,
  ) => void;
}) {
  const historyItems = useMemo(() => {
    const txById = new Map(ledger.transactions.map((t) => [t.id, t]));
    const schedById = new Map((ledger.recurring ?? []).map((s) => [s.id, s]));
    return (ledger.recurring_occurrences ?? [])
      .map((occ) => ({
        occ,
        tx: txById.get(occ.transaction_id),
        schedule: schedById.get(occ.recurring_id),
      }))
      .sort((a, b) =>
        b.occ.occurrence_date.localeCompare(a.occ.occurrence_date),
      );
  }, [ledger.recurring_occurrences, ledger.transactions, ledger.recurring]);

  return (
    <section className="panel section">
      <div className="panel-heading recurring-panel-head">
        <div>
          <h2>
            Occurrence history{" "}
            <span className="count">{historyItems.length}</span>
          </h2>
          <p>
            Confirmed occurrences linked to actual ledger transactions.
            Unlinking or re-linking never deletes or alters transaction amounts.
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
                      <span>{schedule?.name ?? "Recurring payment"}</span>
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
                          {" "}
                          · Linked to <b>"{tx.payee || "Transaction"}"</b> on{" "}
                          {formatShortDate(tx.date)}
                        </>
                      ) : (
                        " · Linked transaction not found"
                      )}
                      {occ.match_reason && (
                        <span className="match-reason-caption">
                          {" "}
                          · {occ.match_reason}
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
                        onRelinkOccurrence?.(occ, schedule, occ.occurrence_date)
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
  );
}
