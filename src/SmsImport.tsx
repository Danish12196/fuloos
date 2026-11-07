import { useEffect, useMemo, useRef, useState } from "react";
import { ImportProgress } from "./ImportProgress";
import { money, type Ledger } from "./domain";
import type { ImportTransaction } from "./csv";
import { CANONICAL, CANONICAL_LABEL } from "./ledger/categoriser";
import { loadLedgerModel, type ModelState } from "./ledger/loader";
import { loadMap, saveMap, type CategoryMap } from "./ledger/mapping";
import { markDuplicates, previewSms } from "./ledger/smsImport";
import {
  buildPersonalModel,
  makeExample,
  suggestCategory,
  type LearningExample,
  type LearningSettings,
} from "./ledger/learning";
import { withConsent, type LearningStore } from "./ledger/learningStore";
import {
  BANK_NAMES,
  smsFromBackupXml,
  splitPastedSms,
  type RawSms,
} from "./ledger/sms";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Edit = Partial<Pick<ImportTransaction, "date" | "payee" | "category_id">>;

export function SmsImport({
  ledger,
  owner,
  learning,
  onClose,
  onImport,
}: {
  ledger: Ledger;
  /** Key for this user's saved category mapping (user id, or "demo"). */
  owner: string;
  /** Learning settings and correction log (account, or this session in demo mode). */
  learning: LearningStore;
  onClose: () => void;
  onImport: (
    rows: ImportTransaction[],
    progress: (n: number) => void,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [modelState, setModelState] = useState<ModelState>({
    status: "loading",
  });
  const [account, setAccount] = useState(ledger.accounts[0]?.id ?? "");
  const [bank, setBank] = useState("");
  const [fallbackDate, setFallbackDate] = useState(today());
  const [pasted, setPasted] = useState("");
  const [fileMessages, setFileMessages] = useState<RawSms[] | null>(null);
  const [filename, setFilename] = useState("");
  const [initialMap] = useState(() => loadMap(owner, ledger.categories));
  const [map, setMap] = useState<CategoryMap>(initialMap.map);
  const [mapOpen, setMapOpen] = useState(!initialMap.saved);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<LearningSettings | null>(null);
  const [examples, setExamples] = useState<LearningExample[]>([]);
  const [learningError, setLearningError] = useState("");
  const [learningBusy, setLearningBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const categoryIds = useMemo(
    () => new Set(ledger.categories.map((c) => c.id)),
    [ledger.categories],
  );

  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    void loadLedgerModel().then((s) => live && setModelState(s));
    learning
      .load(new Set(ledger.categories.map((c) => c.id)))
      .then((data) => {
        if (!live) return;
        setSettings(data.settings);
        setExamples(data.examples);
        // A mapping saved on the account wins over this browser's guess.
        if (data.storedMap) {
          setMap((m) => ({ ...m, ...data.storedMap }));
          setMapOpen(false);
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        setSettings(null);
        setLearningError(
          `Learning settings could not be loaded (${e instanceof Error ? e.message : "unknown error"}). Suggestions still work without them.`,
        );
      });
    return () => {
      live = false;
    };
  }, []);

  const messages = useMemo(
    () => fileMessages ?? splitPastedSms(pasted),
    [fileMessages, pasted],
  );
  const model = modelState.status === "ready" ? modelState.model : null;
  const learnOn = !!settings?.learn_consent;
  const personal = useMemo(
    () =>
      learnOn && examples.length
        ? buildPersonalModel(examples, model, map, categoryIds)
        : null,
    [learnOn, examples, model, map, categoryIds],
  );
  const suggest = useMemo(
    () => (merchant: string | null, amountAed: number) =>
      suggestCategory(personal, model, map, merchant, amountAed),
    [personal, model, map],
  );
  const preview = useMemo(
    () =>
      previewSms(
        messages,
        { account, fallbackDate, bank: bank || null },
        ledger,
        suggest,
      ),
    [messages, account, fallbackDate, bank, ledger, suggest],
  );
  // Duplicates are re-checked on the edited values (a changed date or payee can create or clear one).
  const rows = markDuplicates(
    preview.map((r) => ({
      ...r,
      transaction: r.transaction
        ? { ...r.transaction, ...edits[r.index] }
        : null,
    })),
    ledger,
  );
  const importable = rows.filter((r) => r.transaction);
  const skipped = rows.filter((r) => r.skipped);
  const invalid = rows.filter((r) => r.error);
  const selected = importable.filter(
    (r) => !excluded.has(r.index) && (!r.duplicate || includeDuplicates),
  );
  const needsReview = selected.filter(
    (r) =>
      r.transaction!.type === "expense" &&
      (r.suggestion?.needsReview || !r.transaction!.category_id),
  );
  const visible = showSkipped ? rows : rows.filter((r) => !r.skipped);

  function edit(index: number, patch: Edit) {
    setEdits((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }));
  }
  function updateMap(next: CategoryMap) {
    setMap(next);
    saveMap(owner, next);
    if (settings && learning.scope === "account") {
      const updated = { ...settings, category_map: next };
      setSettings(updated);
      learning
        .saveSettings(updated)
        .then(setSettings)
        .catch((e: unknown) =>
          setLearningError(
            `Could not save the mapping to your account: ${e instanceof Error ? e.message : "unknown error"}`,
          ),
        );
    }
  }
  async function setLearn(on: boolean) {
    if (!settings) return;
    setLearningBusy(true);
    setLearningError("");
    try {
      const saved = await learning.saveSettings(
        withConsent({ ...settings, category_map: map }, on),
      );
      setSettings(saved);
      if (on) {
        const data = await learning.load(categoryIds);
        setExamples(data.examples);
      } else setExamples([]);
    } catch (e) {
      setLearningError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setLearningBusy(false);
    }
  }
  async function clearLearning() {
    setLearningBusy(true);
    setLearningError("");
    try {
      await learning.clearExamples();
      setExamples([]);
      setConfirmClear(false);
    } catch (e) {
      setLearningError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setLearningBusy(false);
    }
  }
  /** Log the user's final choices for imported expenses (only with consent; cleaned merchant text only). */
  async function recordCorrections(rows: typeof selected) {
    if (!learnOn) return;
    const list = rows
      .map((r) =>
        r.transaction?.type === "expense"
          ? makeExample({
              merchant: r.parsed?.merchant_clean ?? null,
              payee: r.transaction.payee,
              amount: r.transaction.amount,
              category_id: r.transaction.category_id,
              suggested_category_id: r.suggestion?.category_id ?? null,
              source: "sms",
              model_version: model ? `ledger-${model.meta.version}` : "rules",
            })
          : null,
      )
      .filter((e): e is LearningExample => !!e);
    if (!list.length) return;
    await learning.addExamples(list);
    setExamples((prev) => [...prev, ...list]);
  }
  function resetInputs() {
    setEdits({});
    setExcluded(new Set());
    setDone(false);
    setError("");
  }
  async function readFile(file?: File) {
    resetInputs();
    if (!file) {
      setFileMessages(null);
      setFilename("");
      return;
    }
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Choose a backup file under 20 MB.");
      const text = await file.text();
      const list =
        /\.xml$/i.test(file.name) || text.trimStart().startsWith("<")
          ? smsFromBackupXml(text)
          : splitPastedSms(text);
      if (list.length > 10000)
        throw new Error("Import at most 10,000 messages at a time.");
      setFileMessages(list);
      setFilename(file.name);
    } catch (e) {
      setFileMessages(null);
      setFilename("");
      setError(e instanceof Error ? e.message : "Could not read this file.");
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
      try {
        await recordCorrections(selected);
      } catch {
        // The import itself is queued; a failed log write only means less learning.
      }
      // Saving continues in the background queue.
      onClose();
    } catch (e) {
      setError(
        `${(e as Error).message} Import stopped. Saved rows are excluded; review before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const modelNote =
    modelState.status === "ready"
      ? `Category suggestions use the Ledger model v${modelState.model.meta.version} plus brand rules, running on this device.`
      : modelState.status === "loading"
        ? "Loading the suggestion model…"
        : modelState.status === "failed"
          ? `Suggestion model unavailable (${modelState.error}). Using brand and keyword rules only.`
          : "Using brand and keyword rules for suggestions. The learning model is not configured on this server.";

  return (
    <dialog
      ref={dialog}
      className="modal csv-modal sms-modal"
      aria-labelledby="sms-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">FROM YOUR BANK ALERTS</span>
          <h2 id="sms-title">Import bank SMS</h2>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label="Close SMS import"
        >
          ×
        </button>
      </div>
      <div className="csv-body">
        <p className="muted">
          Paste bank SMS alerts (separate messages with a blank line) or upload
          an SMS Backup &amp; Restore XML file. Messages are read on this device
          and never uploaded. Only the transactions you confirm are saved, not
          the SMS text.
        </p>
        <fieldset disabled={busy || done}>
          <div className="csv-grid">
            <label>
              Account
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                {ledger.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bank
              <select value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">Detect automatically</option>
                {BANK_NAMES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date when the SMS has none
              <input
                type="date"
                value={fallbackDate}
                onChange={(e) => setFallbackDate(e.target.value || today())}
              />
            </label>
          </div>
          <label>
            Paste SMS
            <textarea
              rows={6}
              value={pasted}
              disabled={!!fileMessages}
              placeholder={
                "Purchase of AED 45.00 with Debit Card ending 1234 at TALABAT, DUBAI. Avl Bal is AED 1,000.00"
              }
              onChange={(e) => {
                resetInputs();
                setPasted(e.target.value);
              }}
            />
          </label>
          <label>
            Or upload SMS backup (.xml) or text file
            <input
              type="file"
              accept=".xml,.txt,text/xml,text/plain"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
          </label>
          {filename && (
            <p className="muted small">
              {filename}: {messages.length} messages.{" "}
              <button
                type="button"
                className="secondary"
                onClick={() => void readFile(undefined)}
              >
                Clear file
              </button>
            </p>
          )}
        </fieldset>
        <p className="muted small" role="status">
          {modelNote}
        </p>
        <section className="sms-learning" aria-label="Learning">
          <label className="csv-check">
            <input
              type="checkbox"
              checked={learnOn}
              disabled={!settings || learningBusy || busy}
              onChange={(e) => void setLearn(e.target.checked)}
            />
            Learn from my categorisations
          </label>
          <p className="muted small">
            When on, Fuloos keeps the cleaned merchant name, amount, payee and
            category you choose for each imported expense
            {learning.scope === "account"
              ? " in your account"
              : " for this session only"}
            , and uses them on this device to suggest your own categories next
            time. SMS text is never kept. Turning this off stops learning;
            delete the data below to remove it.
          </p>
          {learnOn && (
            <p className="muted small" role="status">
              {examples.length} saved{" "}
              {examples.length === 1 ? "correction" : "corrections"}.{" "}
              {personal?.stats.usesClassifier
                ? `Your personal model is on: ${Math.round((personal.stats.personalAccuracy ?? 0) * 100)}% right on your latest ${personal.stats.holdout}, against ${Math.round((personal.stats.baselineAccuracy ?? 0) * 100)}% for the standard mapping.`
                : examples.length < 20
                  ? "Exact merchants you corrected are reused now; the personal model starts after 20 corrections."
                  : "Exact merchants you corrected are reused; the personal model stays off until it beats the standard mapping on your recent corrections."}
            </p>
          )}
          {(learnOn || !!settings?.consent_at) &&
            (confirmClear ? (
              <div className="csv-category-actions">
                <span className="small">
                  Delete all saved corrections? This can't be undone.
                </span>
                <button
                  type="button"
                  className="primary"
                  disabled={learningBusy}
                  onClick={() => void clearLearning()}
                >
                  Delete learning data
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={learningBusy}
                  onClick={() => setConfirmClear(false)}
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="secondary"
                disabled={learningBusy}
                onClick={() => setConfirmClear(true)}
              >
                Delete learning data…
              </button>
            ))}
          {learningError && (
            <p role="alert" className="notice">
              {learningError}
            </p>
          )}
        </section>
        <details
          open={mapOpen}
          onToggle={(e) => setMapOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>Match suggestions to your categories</summary>
          <p className="muted small">
            Suggestions come in 12 standard groups. Choose which of your
            categories each group should fill.
            {learning.scope === "account"
              ? " This is saved to your account."
              : " This is saved in this browser."}
          </p>
          <div className="csv-grid sms-map">
            {CANONICAL.map((c) => (
              <label key={c}>
                {CANONICAL_LABEL[c]}
                <select
                  value={map[c] ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    updateMap({ ...map, [c]: e.target.value || null })
                  }
                >
                  <option value="">Leave uncategorised</option>
                  {ledger.categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.emoji ? `${cat.emoji} ` : ""}
                      {cat.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {!!messages.length && (
          <>
            <h3>Review transactions</h3>
            <p>
              {selected.length} selected · {needsReview.length} need a category
              check · {invalid.length} unreadable · {skipped.length} skipped ·{" "}
              {importable.filter((r) => r.duplicate).length} possible duplicates
            </p>
            <label className="csv-check">
              <input
                type="checkbox"
                checked={includeDuplicates}
                disabled={busy || done}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              Include possible duplicates
            </label>
            <label className="csv-check">
              <input
                type="checkbox"
                checked={showSkipped}
                onChange={(e) => setShowSkipped(e.target.checked)}
              />
              Show skipped messages (OTPs, declined, internal moves)
            </label>
            <div className="csv-table">
              <table>
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Amount</th>
                    <th>Category</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const t = r.transaction;
                    const s = r.suggestion;
                    const status = r.error
                      ? r.error
                      : r.skipped
                        ? `Skipped: ${r.skipped}`
                        : r.duplicate
                          ? "Possible duplicate"
                          : t?.type === "expense" &&
                              (s?.needsReview || !t.category_id)
                            ? "Check category"
                            : "Ready";
                    return (
                      <tr
                        key={r.index}
                        className={
                          status === "Check category" ? "sms-review" : undefined
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include message ${r.index + 1}`}
                            disabled={
                              busy ||
                              done ||
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
                              aria-label={`Date for message ${r.index + 1}`}
                              value={t.date}
                              disabled={busy || done}
                              onChange={(e) =>
                                e.target.value &&
                                edit(r.index, { date: e.target.value })
                              }
                            />
                          ) : (
                            "—"
                          )}
                          {t &&
                            r.dateSource === "fallback" &&
                            !edits[r.index]?.date && (
                              <small className="muted"> no date in SMS</small>
                            )}
                        </td>
                        <td>
                          {t ? (
                            <input
                              aria-label={`Payee for message ${r.index + 1}`}
                              value={t.payee}
                              maxLength={120}
                              disabled={busy || done}
                              onChange={(e) =>
                                edit(r.index, { payee: e.target.value })
                              }
                            />
                          ) : (
                            <small className="muted" title={r.display}>
                              {r.display.slice(0, 80)}
                              {r.display.length > 80 ? "…" : ""}
                            </small>
                          )}
                        </td>
                        <td>
                          {t
                            ? money(t.amount * (t.type === "expense" ? -1 : 1))
                            : "—"}
                        </td>
                        <td>
                          {t?.type === "expense" ? (
                            <>
                              <select
                                aria-label={`Category for message ${r.index + 1}`}
                                value={t.category_id ?? ""}
                                disabled={busy || done}
                                onChange={(e) =>
                                  edit(r.index, {
                                    category_id: e.target.value || null,
                                  })
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
                              {s && s.decidedBy !== "none" && (
                                <small className="muted">
                                  {" "}
                                  {s.canonical
                                    ? CANONICAL_LABEL[s.canonical]
                                    : (ledger.categories.find(
                                        (c) => c.id === s.category_id,
                                      )?.name ?? "")}{" "}
                                  · {Math.round(s.confidence * 100)}% (
                                  {s.decidedBy})
                                </small>
                              )}
                            </>
                          ) : t ? (
                            "Income"
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {done && (
          <p role="status">Imported {progress} transactions successfully.</p>
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
          {done ? "Done" : "Cancel"}
        </button>
        {!done && (
          <button
            className="primary"
            disabled={busy || !selected.length || !account}
            onClick={() => void submit()}
          >
            {busy ? "Importing…" : `Import ${selected.length} transactions`}
          </button>
        )}
      </div>
    </dialog>
  );
}
