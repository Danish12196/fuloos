import { useEffect, useRef, useState } from "react";
import { money, type Ledger } from "./domain";
import {
  parseCsv,
  previewCsv,
  type CsvOptions,
  type ImportTransaction,
} from "./csv";
export function CsvImport({
  ledger,
  onClose,
  onImport,
}: {
  ledger: Ledger;
  onClose: () => void;
  onImport: (
    rows: ImportTransaction[],
    progress: (n: number) => void,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(""),
    [filename, setFilename] = useState(""),
    [delimiter, setDelimiter] = useState(","),
    [header, setHeader] = useState(true),
    [skip, setSkip] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [done, setDone] = useState(false),
    [total, setTotal] = useState(0),
    [excluded, setExcluded] = useState<Set<number>>(new Set()),
    [includeDuplicates, setIncludeDuplicates] = useState(false),
    [reading, setReading] = useState(false);
  const [options, setOptions] = useState<CsvOptions>({
    date: -1,
    payee: -1,
    notes: -1,
    category: -1,
    amount: -1,
    debit: -1,
    credit: -1,
    split: false,
    flip: false,
    decimal: ".",
    dateFormat: "DMY",
    account: ledger.accounts[0]?.id ?? "",
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  let rows: string[][] = [],
    parseError = "";
  try {
    rows = text ? parseCsv(text, delimiter).slice(skip) : [];
  } catch (e) {
    parseError = (e as Error).message;
  }
  const columns =
    rows[0]?.map((v, i) =>
      header ? `${v || "Unnamed"} (${i + 1})` : `Column ${i + 1}`,
    ) ?? [];
  const data = header ? rows.slice(1) : rows;
  const preview = previewCsv(data, options, ledger);
  const selected = preview.filter(
    (r) =>
      r.transaction &&
      !excluded.has(r.index) &&
      (!r.duplicate || includeDuplicates),
  );
  function change<K extends keyof CsvOptions>(key: K, value: CsvOptions[K]) {
    setOptions((o) => ({ ...o, [key]: value }));
    setExcluded(new Set());
    setDone(false);
  }
  function mapping(
    key:
      | "date"
      | "payee"
      | "notes"
      | "category"
      | "amount"
      | "debit"
      | "credit",
    label: string,
  ) {
    return (
      <label>
        {label}
        <select
          value={options[key]}
          onChange={(e) => change(key, Number(e.target.value))}
        >
          <option value={-1}>Choose column…</option>
          {columns.map((c, i) => (
            <option key={i} value={i}>
              {c}
            </option>
          ))}
        </select>
      </label>
    );
  }
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    setReading(true);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose a CSV smaller than 5 MB.");
      const value = await file.text();
      setText(value);
      setFilename(file.name);
      setExcluded(new Set());
      setDone(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  async function submit() {
    setBusy(true);
    setTotal(selected.length);
    setProgress(0);
    setError("");
    try {
      await onImport(
        selected.map((r) => r.transaction!),
        (n) => {
          setProgress(n);
          setExcluded(
            (prev) =>
              new Set([...prev, ...selected.slice(0, n).map((r) => r.index)]),
          );
        },
      );
      setDone(true);
    } catch (e) {
      setError(
        `${(e as Error).message} Import stopped. Successfully saved rows are excluded; review before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal csv-modal"
      aria-labelledby="csv-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">BRING YOUR MONEY INTO VIEW</span>
          <h2 id="csv-title">Import CSV</h2>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label="Close import"
        >
          ×
        </button>
      </div>
      <div className="csv-body">
        <p className="muted">
          Choose a bank CSV, match its columns, then review before importing.
          Amounts are in AED. Transfers should be added separately.
        </p>
        <fieldset disabled={busy || done || reading}>
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
          {filename && (
            <p>
              {filename} · {data.length} rows
            </p>
          )}
          <div className="csv-grid">
            <label>
              Import into account
              <select
                value={options.account}
                onChange={(e) => change("account", e.target.value)}
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
              Delimiter
              <select
                value={delimiter}
                onChange={(e) => {
                  setDelimiter(e.target.value);
                  setExcluded(new Set());
                }}
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={"\t"}>Tab</option>
                <option value="|">Pipe</option>
              </select>
            </label>
            <label>
              Skip leading rows
              <input
                type="number"
                min="0"
                max="10000"
                value={skip}
                onChange={(e) => {
                  setSkip(Math.max(0, Number(e.target.value)));
                  setExcluded(new Set());
                }}
              />
            </label>
            <label>
              Date format
              <select
                value={options.dateFormat}
                onChange={(e) =>
                  change(
                    "dateFormat",
                    e.target.value as CsvOptions["dateFormat"],
                  )
                }
              >
                <option value="DMY">DD/MM/YYYY</option>
                <option value="MDY">MM/DD/YYYY</option>
                <option value="YMD">YYYY-MM-DD</option>
              </select>
            </label>
            <label>
              Decimal separator
              <select
                value={options.decimal}
                onChange={(e) => change("decimal", e.target.value as "." | ",")}
              >
                <option value=".">Dot · 1,234.56</option>
                <option value=",">Comma · 1.234,56</option>
              </select>
            </label>
          </div>
          <label className="csv-check">
            <input
              type="checkbox"
              checked={header}
              onChange={(e) => {
                setHeader(e.target.checked);
                setExcluded(new Set());
              }}
            />
            First row contains column names
          </label>
          <label className="csv-check">
            <input
              type="checkbox"
              checked={options.split}
              onChange={(e) => change("split", e.target.checked)}
            />
            Separate debit / credit columns
          </label>
          <label className="csv-check">
            <input
              type="checkbox"
              checked={options.flip}
              onChange={(e) => change("flip", e.target.checked)}
            />
            Flip amount signs
          </label>
          {!!columns.length && (
            <div className="csv-grid">
              {mapping("date", "Date *")}
              {options.split ? (
                <>
                  {mapping("debit", "Debit / money out *")}
                  {mapping("credit", "Credit / money in *")}
                </>
              ) : (
                mapping("amount", "Amount *")
              )}
              {mapping("payee", "Payee / description")}
              {mapping("notes", "Notes")}
              {mapping("category", "Category (existing names)")}
            </div>
          )}
          <p className="muted small">
            Signed amounts: negative = expense, positive = income. Debit/credit
            amounts must be positive. Unmapped categories stay uncategorized.
          </p>
        </fieldset>
        {(parseError || error) && (
          <p role="alert" className="notice">
            {parseError || error}
          </p>
        )}
        {!!preview.length && !parseError && (
          <>
            <h3>Review transactions</h3>
            <p>
              {selected.length} selected ·{" "}
              {preview.filter((r) => r.error).length} invalid ·{" "}
              {preview.filter((r) => r.duplicate).length} possible duplicates
            </p>
            <label className="csv-check">
              <input
                type="checkbox"
                disabled={busy || done}
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              Include possible duplicates (same account, date, amount and payee)
            </label>
            <div className="csv-table">
              <table>
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>Row</th>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.index}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include row ${r.index + 1}`}
                          disabled={
                            busy ||
                            done ||
                            !r.transaction ||
                            (r.duplicate && !includeDuplicates)
                          }
                          checked={
                            !!r.transaction &&
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
                      <td>{r.index + skip + (header ? 2 : 1)}</td>
                      <td>{r.transaction?.date ?? "—"}</td>
                      <td>{r.transaction?.payee || "—"}</td>
                      <td>
                        {r.transaction
                          ? money(
                              r.transaction.amount *
                                (r.transaction.type === "expense" ? -1 : 1),
                            )
                          : "—"}
                      </td>
                      <td>
                        {r.error ||
                          (r.duplicate ? "Possible duplicate" : "Ready")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {busy && (
          <p role="status">
            Imported {progress} of {total}…
          </p>
        )}
        {done && (
          <p role="status">Imported {progress} transactions successfully.</p>
        )}
      </div>
      <div className="modal-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          {done ? "Done" : "Cancel"}
        </button>
        {!done && (
          <button
            className="button primary"
            disabled={busy || reading || !!parseError || !selected.length}
            onClick={() => void submit()}
          >
            {busy ? "Importing…" : `Import ${selected.length} transactions`}
          </button>
        )}
      </div>
    </dialog>
  );
}
