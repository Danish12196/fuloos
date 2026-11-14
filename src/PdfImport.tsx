import { useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ImportProgress } from "./ImportProgress";
import { money, validateTransaction, type Ledger, type Transaction } from "./domain";
import { transactionKey, type ImportTransaction } from "./csv";
import {
  extractPdfPages,
  markPdfDuplicates,
  parsePdfStatement,
  PDF_BANKS,
  type PdfBank,
  type PdfLine,
  type PdfPreviewRow,
} from "./pdfImport";
import {
  appliedMatches,
  findTransferMatches,
  pairedTransfer,
  type TransferDecision,
} from "./transferMatch";

type Edit = Partial<Pick<ImportTransaction, "date" | "payee" | "category_id" | "type">>;

export function PdfImport({
  ledger,
  onClose,
  onImport,
}: {
  ledger: Ledger;
  onClose: () => void;
  onImport: (
    rows: ImportTransaction[],
    progress: (n: number) => void,
    paired: Transaction[],
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [account, setAccount] = useState(ledger.accounts[0]?.id ?? "");
  const [bankOverride, setBankOverride] = useState<PdfBank | "">("");
  const [dateFormat, setDateFormat] = useState<"DMY" | "MDY">("DMY");
  const [pages, setPages] = useState<PdfLine[][] | null>(null);
  const [filename, setFilename] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [decisions, setDecisions] = useState<Map<number, TransferDecision>>(
    new Map(),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const parsed = useMemo(() => {
    if (!pages || !account) return null;
    return parsePdfStatement(
      pages,
      {
        account,
        bank: bankOverride || null,
        dateFormat,
      },
      ledger,
    );
  }, [pages, account, bankOverride, dateFormat, ledger]);

  const editedRows = useMemo<PdfPreviewRow[]>(() => {
    if (!parsed) return [];
    const withEdits = parsed.rows.map((r) => {
      if (!r.transaction) return r;
      const patch = edits[r.index];
      if (!patch) return r;
      const nextTx: ImportTransaction = {
        ...r.transaction,
        ...patch,
        category_id:
          patch.type === "income"
            ? null
            : patch.category_id !== undefined
              ? patch.category_id
              : r.transaction.category_id,
      };
      return { ...r, transaction: nextTx };
    });
    return markPdfDuplicates(withEdits, ledger);
  }, [parsed, edits, ledger]);

  const matches = useMemo(
    () => findTransferMatches(editedRows, account, ledger),
    [editedRows, account, ledger],
  );
  const applied = useMemo(
    () => appliedMatches(matches, decisions),
    [matches, decisions],
  );
  const appliedByIndex = useMemo(
    () => new Map(applied.map((m) => [m.index, m])),
    [applied],
  );
  const matchByIndex = useMemo(
    () => new Map(matches.map((m) => [m.index, m])),
    [matches],
  );
  const accountById = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a])),
    [ledger.accounts],
  );

  const rows = useMemo<PdfPreviewRow[]>(() => {
    if (!applied.length) return editedRows;
    const recorded = new Set(
      applied.filter((m) => m.kind === "recorded").map((m) => m.index),
    );
    const seen = new Set(ledger.transactions.map(transactionKey));
    return editedRows.map((r) => {
      const m = appliedByIndex.get(r.index);
      let next = r;
      if (m && r.transaction && r.transaction.type !== "transfer") {
        const isCredit =
          r.transaction.type === "income" && r.transaction.amount > 0;
        const tx: ImportTransaction = {
          ...r.transaction,
          account_id: isCredit ? m.otherAccount : account,
          to_account_id: isCredit ? account : m.otherAccount,
          category_id: null,
          type: "transfer",
        };
        try {
          validateTransaction(tx, ledger);
          next = { ...r, transaction: tx, error: "" };
        } catch (e) {
          return {
            ...r,
            transaction: null,
            duplicate: false,
            error: e instanceof Error ? e.message : "Invalid row.",
          };
        }
      }
      if (!next.transaction) return next;
      const key = transactionKey(next.transaction);
      const duplicate = recorded.has(r.index) || seen.has(key);
      seen.add(key);
      return duplicate === next.duplicate ? next : { ...next, duplicate };
    });
  }, [editedRows, applied, appliedByIndex, account, ledger]);

  const selected = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.transaction &&
          !excluded.has(r.index) &&
          (!r.duplicate || includeDuplicates),
      ),
    [rows, excluded, includeDuplicates],
  );

  const duplicateCount = useMemo(
    () => rows.filter((r) => r.duplicate).length,
    [rows],
  );
  const invalidCount = useMemo(
    () => rows.filter((r) => !!r.error).length,
    [rows],
  );

  function resetChoices() {
    setEdits({});
    setExcluded(new Set());
    setDecisions(new Map());
  }

  async function handleFile(file?: File) {
    resetChoices();
    setError("");
    if (!file) {
      setPages(null);
      setFilename("");
      return;
    }
    setReading(true);
    try {
      if (file.size > 25 * 1024 * 1024) {
        throw new Error("Choose a PDF smaller than 25 MB.");
      }
      const buffer = await file.arrayBuffer();
      const extracted = await extractPdfPages(buffer, pdfWorkerUrl);
      if (!extracted.some((p) => p.length > 0)) {
        throw new Error(
          "No selectable text found in this PDF. Scanned image-only PDFs are not supported yet.",
        );
      }
      setPages(extracted);
      setFilename(file.name);
    } catch (e) {
      setPages(null);
      setFilename("");
      setError(e instanceof Error ? e.message : "Could not read this PDF.");
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    const creates = selected.filter(
      (r) => appliedByIndex.get(r.index)?.kind !== "pair",
    );
    const paired = selected.flatMap((r) => {
      const m = appliedByIndex.get(r.index);
      return m?.kind === "pair" && m.counterpart
        ? [pairedTransfer(m.counterpart, account)]
        : [];
    });
    setBusy(true);
    setTotal(creates.length);
    setProgress(0);
    setError("");
    try {
      await onImport(
        creates.map((r) => r.transaction!),
        (n) => {
          setProgress(n);
          setExcluded(
            (prev) =>
              new Set([...prev, ...creates.slice(0, n).map((r) => r.index)]),
          );
        },
        paired,
      );
      onClose();
    } catch (e) {
      setError(
        `${(e as Error).message} Import stopped. Saved rows are excluded; review before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal csv-modal"
      aria-labelledby="pdf-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">PRIVATE BROWSER PARSING</span>
          <h2 id="pdf-title">Import PDF statement</h2>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label="Close PDF import"
        >
          ×
        </button>
      </div>
      <div className="csv-body">
        <p className="muted">
          Choose a UAE bank PDF statement (ENBD, ADCB, FAB, Mashreq, Liv, ADIB,
          or generic). Your PDF is parsed 100% in your browser and never
          uploaded.
        </p>
        <fieldset disabled={busy || reading}>
          <label>
            PDF statement file
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </label>
          {reading && (
            <p className="muted small" role="status">
              Reading PDF pages…
            </p>
          )}
          {filename && parsed && (
            <p className="small">
              {filename} · {parsed.pageCount}{" "}
              {parsed.pageCount === 1 ? "page" : "pages"} · Bank:{" "}
              <strong>{parsed.bank}</strong> · {rows.length} rows found
            </p>
          )}
          <div className="csv-grid">
            <label>
              Import into account
              <select
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  resetChoices();
                }}
              >
                <option value="">Choose account…</option>
                {ledger.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bank format
              <select
                value={bankOverride}
                onChange={(e) => {
                  setBankOverride(e.target.value as PdfBank | "");
                  resetChoices();
                }}
              >
                <option value="">Detect automatically</option>
                {PDF_BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date format
              <select
                value={dateFormat}
                onChange={(e) => {
                  setDateFormat(e.target.value as "DMY" | "MDY");
                  resetChoices();
                }}
              >
                <option value="DMY">DD/MM/YYYY</option>
                <option value="MDY">MM/DD/YYYY</option>
              </select>
            </label>
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}

        {parsed && parsed.warnings.length > 0 && (
          <details className="notice">
            <summary>
              {parsed.warnings.length} unparsed{" "}
              {parsed.warnings.length === 1 ? "line" : "lines"} skipped
            </summary>
            <ul>
              {parsed.warnings.slice(0, 30).map((w, idx) => (
                <li key={idx} className="small">
                  Page {w.page}: {w.reason} — <code>{w.line.slice(0, 100)}</code>
                </li>
              ))}
              {parsed.warnings.length > 30 && (
                <li className="small">
                  …and {parsed.warnings.length - 30} more lines.
                </li>
              )}
            </ul>
          </details>
        )}

        {parsed && (
          <>
            <h3>Review transactions</h3>
            <p>
              {selected.length} selected · {duplicateCount} possible duplicates
              {invalidCount > 0 ? ` · ${invalidCount} invalid` : ""}
            </p>
            <label className="csv-check">
              <input
                type="checkbox"
                checked={includeDuplicates}
                disabled={busy}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              Include possible duplicates
            </label>
            {rows.length > 0 ? (
              <div className="csv-table">
                <table>
                  <thead>
                    <tr>
                      <th>Include</th>
                      <th>Date</th>
                      <th>Payee</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Category</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const t = r.transaction;
                      const match = matchByIndex.get(r.index);
                      const appliedMatch = appliedByIndex.get(r.index);
                      const status = r.error
                        ? r.error
                        : appliedMatch
                          ? `Transfer (${accountById.get(appliedMatch.otherAccount)?.name ?? "account"})`
                          : r.duplicate
                            ? "Possible duplicate"
                            : match && !decisions.has(r.index)
                              ? `Possible transfer to/from ${accountById.get(match.otherAccount)?.name ?? "account"}`
                              : "Ready";
                      return (
                        <tr key={r.index}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Include row ${r.index + 1}`}
                              disabled={
                                busy ||
                                !t ||
                                (r.duplicate && !includeDuplicates)
                              }
                              checked={
                                !!t &&
                                !excluded.has(r.index) &&
                                (!r.duplicate || includeDuplicates)
                              }
                              onChange={(e) =>
                                setExcluded((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.delete(r.index);
                                  else next.add(r.index);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td>
                            {t ? (
                              <input
                                type="date"
                                aria-label={`Date for row ${r.index + 1}`}
                                value={t.date}
                                disabled={busy}
                                onChange={(e) =>
                                  e.target.value &&
                                  setEdits((prev) => ({
                                    ...prev,
                                    [r.index]: {
                                      ...prev[r.index],
                                      date: e.target.value,
                                    },
                                  }))
                                }
                              />
                            ) : (
                              r.date || "—"
                            )}
                          </td>
                          <td>
                            {t ? (
                              <input
                                aria-label={`Payee for row ${r.index + 1}`}
                                value={t.payee}
                                maxLength={120}
                                disabled={busy}
                                onChange={(e) =>
                                  setEdits((prev) => ({
                                    ...prev,
                                    [r.index]: {
                                      ...prev[r.index],
                                      payee: e.target.value,
                                    },
                                  }))
                                }
                              />
                            ) : (
                              <small className="muted">{r.description}</small>
                            )}
                          </td>
                          <td>
                            {t && t.type !== "transfer" ? (
                              <select
                                aria-label={`Type for row ${r.index + 1}`}
                                value={t.type}
                                disabled={busy}
                                onChange={(e) =>
                                  setEdits((prev) => ({
                                    ...prev,
                                    [r.index]: {
                                      ...prev[r.index],
                                      type: e.target.value as "expense" | "income",
                                    },
                                  }))
                                }
                              >
                                <option value="expense">Expense</option>
                                <option value="income">Income</option>
                              </select>
                            ) : (
                              <span>{t?.type ?? "—"}</span>
                            )}
                          </td>
                          <td>
                            {t
                              ? money(
                                  t.amount * (t.type === "expense" ? -1 : 1),
                                )
                              : "—"}
                          </td>
                          <td>
                            {t?.type === "expense" ? (
                              <select
                                aria-label={`Category for row ${r.index + 1}`}
                                value={t.category_id ?? ""}
                                disabled={busy}
                                onChange={(e) =>
                                  setEdits((prev) => ({
                                    ...prev,
                                    [r.index]: {
                                      ...prev[r.index],
                                      category_id: e.target.value || null,
                                    },
                                  }))
                                }
                              >
                                <option value="">Uncategorised</option>
                                {ledger.categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.emoji ? `${c.emoji} ` : ""}
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            ) : t?.type === "transfer" ? (
                              "Transfer"
                            ) : t ? (
                              "Income"
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <span>{status}</span>
                            {match && (
                              <div className="csv-category-actions">
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() =>
                                    setDecisions((prev) => {
                                      const next = new Map(prev);
                                      next.set(
                                        r.index,
                                        appliedMatch ? "reject" : "accept",
                                      );
                                      return next;
                                    })
                                  }
                                >
                                  {appliedMatch ? "Not a transfer" : "Mark transfer"}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                No transactions could be extracted from this PDF.
              </p>
            )}
          </>
        )}
      </div>
      <div className="modal-actions">
        {total > 0 && (
          <ImportProgress
            label="Transactions imported"
            value={progress}
            total={total}
          />
        )}
        <button className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || !selected.length || !account}
          onClick={() => void submit()}
        >
          {busy ? "Importing…" : `Import ${selected.length} transactions`}
        </button>
      </div>
    </dialog>
  );
}
