import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ClipboardPaste,
  Copy,
  KeyRound,
  Mail,
  RefreshCw,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import {
  alertToImportTransaction,
  buildCaptureWebhookUrl,
  buildShortcutSnippet,
  matchAccountHint,
  parseClipboardOrShareAlert,
  pendingCapturedAlerts,
  suggestCategoryForAlert,
  type AlertDraftOverrides,
} from "./captureAlerts";
import type { ImportTransaction } from "./csv";
import {
  errorMessage,
  minor,
  money,
  uaeToday,
  type CaptureTokenInfo,
  type CapturedAlert,
  type Ledger,
} from "./domain";
import { loadLedgerModel, type ModelState } from "./ledger/loader";
import { loadMap } from "./ledger/mapping";
import {
  buildPersonalModel,
  suggestCategory,
  type LearningExample,
  type LearningSettings,
} from "./ledger/learning";
import type { LearningStore } from "./ledger/learningStore";

interface RowDraft {
  account_id?: string;
  category_id?: string | null;
  type?: "expense" | "income";
  amountText?: string;
  date?: string;
  payee?: string;
}

export function CaptureAlertsModal({
  demo,
  pbUrl,
  ledger,
  owner,
  learning,
  onClose,
  onImportAlert,
  onDismissAlert,
  onAddAlert,
  onLoadToken,
  onRotateToken,
  onUpdateTokenSettings,
}: {
  demo: boolean;
  pbUrl: string;
  ledger: Ledger;
  owner: string;
  learning: LearningStore;
  onClose: () => void;
  onImportAlert: (
    alert: CapturedAlert,
    tx: ImportTransaction,
  ) => Promise<void>;
  onDismissAlert: (alertId: string) => Promise<void>;
  onAddAlert: (draft: Omit<CapturedAlert, "id">) => Promise<void>;
  onLoadToken?: () => Promise<{
    token: CaptureTokenInfo | null;
    supported: boolean;
  }>;
  onRotateToken?: () => Promise<{
    id: string;
    token: string;
    token_preview: string;
    enabled: boolean;
    default_account_id: string | null;
  }>;
  onUpdateTokenSettings?: (
    id: string,
    patch: { enabled?: boolean; default_account_id?: string | null },
  ) => Promise<CaptureTokenInfo>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [modelState, setModelState] = useState<ModelState>({
    status: "loading",
  });
  const [settings, setSettings] = useState<LearningSettings | null>(null);
  const [examples, setExamples] = useState<LearningExample[]>([]);
  const [map, setMap] = useState(() => loadMap(owner, ledger.categories).map);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // Clipboard / Quick-paste state
  const [pasteText, setPasteText] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  // Webhook & Token state
  const [tokenSupported, setTokenSupported] = useState(true);
  const [tokenInfo, setTokenInfo] = useState<CaptureTokenInfo | null>(null);
  const [revealedToken, setRevealedToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");

  const categoryIds = useMemo(
    () => new Set(ledger.categories.map((c) => c.id)),
    [ledger.categories],
  );

  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    void loadLedgerModel().then((s) => live && setModelState(s));
    void learning
      .load(categoryIds)
      .then((data) => {
        if (!live) return;
        setSettings(data.settings);
        setExamples(data.examples);
        if (data.storedMap) setMap((m) => ({ ...m, ...data.storedMap }));
      })
      .catch(() => {});

    if (!demo && onLoadToken) {
      void onLoadToken()
        .then((res) => {
          if (!live) return;
          setTokenSupported(res.supported);
          setTokenInfo(res.token);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, []);

  const model = modelState.status === "ready" ? modelState.model : null;
  const personal = useMemo(
    () =>
      settings?.learn_consent && examples.length
        ? buildPersonalModel(examples, model, map, categoryIds)
        : null,
    [settings?.learn_consent, examples, model, map, categoryIds],
  );
  const suggest = useMemo(
    () => (merchant: string | null, amountAed: number) =>
      suggestCategory(personal, model, map, merchant, amountAed),
    [personal, model, map],
  );

  const pending = useMemo(
    () => pendingCapturedAlerts(ledger.captured_alerts),
    [ledger.captured_alerts],
  );

  function setDraft(id: string, patch: RowDraft) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handlePasteFromClipboard() {
    setError("");
    setStatusMsg("");
    try {
      if (!navigator.clipboard?.readText) {
        setError(
          "Clipboard access is unavailable in this browser. Paste the alert text below.",
        );
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("Your clipboard is empty. Copy a bank alert first.");
        return;
      }
      setPasteText(text);
      await addAlertFromText(text);
    } catch {
      setError(
        "Clipboard permission denied. Paste the alert text into the box below and click Add alert.",
      );
    }
  }

  async function addAlertFromText(text: string) {
    setPasteBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const draft = parseClipboardOrShareAlert(text, {
        source: "shortcut",
        fallbackDate: uaeToday(),
      });
      await onAddAlert(draft);
      setPasteText("");
      setStatusMsg("Alert parsed and added to your pending queue.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPasteBusy(false);
    }
  }

  async function handleImport(alert: CapturedAlert) {
    setBusyId(alert.id);
    setError("");
    setStatusMsg("");
    try {
      const d = drafts[alert.id] ?? {};
      const amount =
        d.amountText !== undefined
          ? minor(d.amountText)
          : alert.parsed_amount;
      const overrides: AlertDraftOverrides = {
        account_id:
          d.account_id ??
          matchAccountHint(
            alert.account_hint,
            ledger.accounts,
            tokenInfo?.default_account_id,
          ),
        category_id: d.category_id,
        type:
          d.type ??
          (alert.parsed_type === "income" ? "income" : "expense"),
        amount,
        date: d.date ?? (alert.parsed_date || uaeToday()),
        payee: d.payee,
      };
      const tx = alertToImportTransaction(alert, ledger, overrides, suggest);
      await onImportAlert(alert, tx);
      setStatusMsg(
        `Imported ${money(tx.amount)} (${tx.payee || "transaction"}).`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(alertId: string) {
    setBusyId(alertId);
    setError("");
    setStatusMsg("");
    try {
      await onDismissAlert(alertId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRotateToken() {
    if (!onRotateToken) return;
    setTokenBusy(true);
    setError("");
    try {
      const res = await onRotateToken();
      setRevealedToken(res.token);
      setTokenInfo({
        id: res.id,
        token_preview: res.token_preview,
        enabled: res.enabled,
        default_account_id: res.default_account_id,
      });
      setStatusMsg(
        "New capture token generated. Copy it now — it won't be shown in full again.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTokenBusy(false);
    }
  }

  async function handleToggleEnabled(enabled: boolean) {
    if (!tokenInfo || !onUpdateTokenSettings) return;
    setTokenBusy(true);
    setError("");
    try {
      const updated = await onUpdateTokenSettings(tokenInfo.id, { enabled });
      setTokenInfo(updated);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTokenBusy(false);
    }
  }

  async function handleDefaultAccount(default_account_id: string) {
    if (!tokenInfo || !onUpdateTokenSettings) return;
    setTokenBusy(true);
    setError("");
    try {
      const updated = await onUpdateTokenSettings(tokenInfo.id, {
        default_account_id: default_account_id || null,
      });
      setTokenInfo(updated);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTokenBusy(false);
    }
  }

  function copyText(key: string, value: string) {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1800);
    });
  }

  const webhookUrl = buildCaptureWebhookUrl(
    pbUrl || "https://your-pocketbase-host",
  );

  return (
    <dialog
      ref={dialog}
      className="modal csv-modal sms-modal"
      aria-labelledby="capture-alerts-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busyId) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">AUTOMATIC CAPTURE</span>
          <h2 id="capture-alerts-title">
            Captured Alerts ({pending.length})
          </h2>
        </div>
        <button
          className="icon-button"
          disabled={!!busyId}
          onClick={onClose}
          aria-label="Close captured alerts"
        >
          <X size={18} />
        </button>
      </div>

      <div className="csv-body">
        <p className="muted">
          Review bank alerts forwarded by email, iOS Shortcuts, Android Tasker,
          or pasted from your clipboard. Nothing enters your ledger until you
          confirm.
        </p>

        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {statusMsg && (
          <p role="status" className="muted small">
            {statusMsg}
          </p>
        )}

        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "12px",
            marginBottom: "14px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "8px",
            }}
          >
            <strong>Clipboard &amp; Quick-Parse</strong>
            <button
              type="button"
              className="secondary"
              disabled={pasteBusy || !ledger.accounts.length}
              onClick={() => void handlePasteFromClipboard()}
            >
              <ClipboardPaste size={15} /> Paste from clipboard
            </button>
          </div>
          <textarea
            rows={2}
            value={pasteText}
            disabled={pasteBusy}
            placeholder="Or paste a UAE bank SMS/email alert here (Liv, Mashreq, ADCB, FAB, ADIB, ENBD)…"
            onChange={(e) => setPasteText(e.target.value)}
          />
          {pasteText.trim() && (
            <div style={{ marginTop: "8px" }}>
              <button
                type="button"
                className="primary"
                disabled={pasteBusy || !ledger.accounts.length}
                onClick={() => void addAlertFromText(pasteText)}
              >
                {pasteBusy ? "Parsing…" : "Parse & add to queue"}
              </button>
            </div>
          )}
        </section>

        <h3>Pending queue ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="muted small">
            No pending alerts. Forward a bank alert email, trigger a Shortcut,
            or paste an alert above.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "10px", marginBottom: "14px" }}>
            {pending.map((alert) => {
              const d = drafts[alert.id] ?? {};
              const suggested = suggestCategoryForAlert(alert, ledger, suggest);
              const type =
                d.type ??
                (alert.parsed_type === "income" ? "income" : "expense");
              const accountId =
                d.account_id ??
                matchAccountHint(
                  alert.account_hint,
                  ledger.accounts,
                  tokenInfo?.default_account_id,
                );
              const categoryId =
                d.category_id !== undefined
                  ? (d.category_id ?? "")
                  : (suggested.category_id ?? "");
              const payee = d.payee ?? suggested.payee;
              const date = d.date ?? (alert.parsed_date || uaeToday());
              const amountText =
                d.amountText ?? (alert.parsed_amount / 100).toFixed(2);
              const isBusy = busyId === alert.id;

              return (
                <div
                  key={alert.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "12px",
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="small muted">
                      {alert.source === "email" ? (
                        <>
                          <Mail size={13} style={{ verticalAlign: "-2px" }} />{" "}
                          Email
                        </>
                      ) : (
                        <>
                          <Smartphone
                            size={13}
                            style={{ verticalAlign: "-2px" }}
                          />{" "}
                          Shortcut / Clipboard
                        </>
                      )}
                      {alert.account_hint ? ` · ${alert.account_hint}` : ""}
                    </span>
                    <strong>
                      {alert.parsed_amount > 0
                        ? money(
                            alert.parsed_amount * (type === "expense" ? -1 : 1),
                          )
                        : "Amount needed"}
                    </strong>
                  </div>

                  <div className="csv-grid">
                    <label>
                      Type
                      <select
                        value={type}
                        disabled={isBusy}
                        onChange={(e) =>
                          setDraft(alert.id, {
                            type: e.target.value as "expense" | "income",
                          })
                        }
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                    </label>
                    <label>
                      Account
                      <select
                        value={accountId}
                        disabled={isBusy}
                        onChange={(e) =>
                          setDraft(alert.id, { account_id: e.target.value })
                        }
                      >
                        {ledger.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Date
                      <input
                        type="date"
                        value={date}
                        disabled={isBusy}
                        onChange={(e) =>
                          setDraft(alert.id, { date: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Amount (AED)
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amountText}
                        disabled={isBusy}
                        onChange={(e) =>
                          setDraft(alert.id, { amountText: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Payee
                      <input
                        type="text"
                        maxLength={120}
                        value={payee}
                        disabled={isBusy}
                        onChange={(e) =>
                          setDraft(alert.id, { payee: e.target.value })
                        }
                      />
                    </label>
                    {type === "expense" && (
                      <label>
                        Category
                        <select
                          value={categoryId}
                          disabled={isBusy}
                          onChange={(e) =>
                            setDraft(alert.id, {
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
                      </label>
                    )}
                  </div>

                  <details>
                    <summary className="small muted">Raw alert text</summary>
                    <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>
                      {alert.subject ? `${alert.subject}\n` : ""}
                      {alert.raw_text}
                    </p>
                  </details>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                    }}
                  >
                    <button
                      type="button"
                      className="secondary"
                      disabled={isBusy}
                      onClick={() => void handleDismiss(alert.id)}
                    >
                      <Trash2 size={14} /> Dismiss
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={isBusy || !ledger.accounts.length}
                      onClick={() => void handleImport(alert)}
                    >
                      <Check size={14} />{" "}
                      {isBusy ? "Importing…" : "Confirm & import"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <details>
          <summary>
            <strong>Email-Forward &amp; Shortcut Setup</strong>
          </summary>
          <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
            {demo ? (
              <p className="muted small">
                Sign in with a live PocketBase account to generate your personal
                webhook token for Cloudflare Email Workers, iOS Shortcuts, or
                Android Tasker.
              </p>
            ) : !tokenSupported ? (
              <p className="notice small">
                Captured alerts migration (
                <code>1794600000_captured_alerts.js</code>) is not installed on
                the server yet.
              </p>
            ) : (
              <>
                <div>
                  <span className="small muted">Personal Webhook URL</span>
                  <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <input type="text" readOnly value={webhookUrl} />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => copyText("url", webhookUrl)}
                    >
                      <Copy size={14} />{" "}
                      {copiedKey === "url" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    className="secondary"
                    disabled={tokenBusy}
                    onClick={() => void handleRotateToken()}
                  >
                    {tokenInfo ? (
                      <>
                        <RefreshCw size={14} /> Rotate capture token
                      </>
                    ) : (
                      <>
                        <KeyRound size={14} /> Generate capture token
                      </>
                    )}
                  </button>
                  {tokenInfo && (
                    <span className="small muted">
                      Active token: <code>{tokenInfo.token_preview}</code>
                    </span>
                  )}
                </div>

                {revealedToken && (
                  <div className="notice small">
                    <strong>New token (copy now):</strong>
                    <div
                      style={{ display: "flex", gap: "6px", marginTop: "4px" }}
                    >
                      <input type="text" readOnly value={revealedToken} />
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => copyText("token", revealedToken)}
                      >
                        <Copy size={14} />{" "}
                        {copiedKey === "token" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                {tokenInfo && (
                  <div className="csv-grid">
                    <label className="csv-check">
                      <input
                        type="checkbox"
                        checked={tokenInfo.enabled}
                        disabled={tokenBusy}
                        onChange={(e) =>
                          void handleToggleEnabled(e.target.checked)
                        }
                      />
                      Enable inbound webhook
                    </label>
                    <label>
                      Default account for alerts
                      <select
                        value={tokenInfo.default_account_id ?? ""}
                        disabled={tokenBusy}
                        onChange={(e) =>
                          void handleDefaultAccount(e.target.value)
                        }
                      >
                        <option value="">Auto-detect / first account</option>
                        {ledger.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                <div className="small muted" style={{ display: "grid", gap: "6px" }}>
                  <p>
                    <strong>1. Email Forwarding (Cloudflare Email Worker / Postmark / Resend):</strong>{" "}
                    Forward bank alert emails to a worker that POSTs{" "}
                    <code>{`{ "token", "subject", "text", "html" }`}</code> to
                    the webhook URL above.
                  </p>
                  <p>
                    <strong>2. iOS Shortcuts / Android Tasker:</strong> Create a
                    shortcut or Tasker profile on bank SMS/notification that
                    sends an HTTP POST JSON with{" "}
                    <code>{`{ "token", "source": "shortcut", "text": "..." }`}</code>.
                  </p>
                  <pre
                    style={{
                      overflowX: "auto",
                      padding: "8px",
                      borderRadius: "6px",
                      background: "var(--surface-2, rgba(0,0,0,0.04))",
                    }}
                  >
                    {buildShortcutSnippet(webhookUrl, revealedToken)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </details>
      </div>

      <div className="modal-actions">
        <button
          className="primary"
          disabled={!!busyId}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </dialog>
  );
}
