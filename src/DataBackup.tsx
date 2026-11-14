import { useRef, useState } from "react";
import { Download, FileJson, FileSpreadsheet, Upload } from "lucide-react";
import {
  createBackup,
  isLedgerEmpty,
  MAX_BACKUP_BYTES,
  parseAndValidateBackup,
  serializeBackup,
  type BackupPreview,
  type FuloosBackup,
  type RestoreMode,
} from "./backup";
import type { PresetStore } from "./csvPresets";
import { errorMessage, plural, today, type Ledger } from "./domain";
import { downloadBlob, transactionsToCsv } from "./export";

export function DataBackup({
  ledger,
  presetStore,
  busy,
  onRestore,
}: {
  ledger: Ledger;
  presetStore: Pick<PresetStore, "load" | "save">;
  busy?: boolean;
  onRestore: (backup: FuloosBackup, mode: RestoreMode) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<{
    backup: FuloosBackup;
    preview: BackupPreview;
  } | null>(null);
  const workspaceEmpty = isLedgerEmpty(ledger);
  const [mode, setMode] = useState<RestoreMode>(
    workspaceEmpty ? "empty" : "merge",
  );
  const [confirmed, setConfirmed] = useState(false);

  const disabled = Boolean(busy || exporting || restoring);

  async function handleExportCsv() {
    setError("");
    setStatus("");
    setExporting(true);
    try {
      const csv = transactionsToCsv(ledger.transactions, ledger);
      downloadBlob(
        csv,
        `fuloos-transactions-${today()}.csv`,
        "text/csv;charset=utf-8",
      );
      setStatus(
        `Exported ${plural(ledger.transactions.length, "transaction")} to CSV.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleExportJson() {
    setError("");
    setStatus("");
    setExporting(true);
    try {
      const { presets } = await presetStore.load();
      const backup = createBackup(ledger, presets);
      downloadBlob(
        serializeBackup(backup),
        `fuloos-backup-${today()}.json`,
        "application/json;charset=utf-8",
      );
      setStatus("Downloaded full account backup (JSON).");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelect(file: File | undefined) {
    setError("");
    setStatus("");
    setParsed(null);
    setConfirmed(false);
    setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setError("Backup file exceeds the 10 MB size limit.");
      return;
    }
    try {
      const text = await file.text();
      const result = parseAndValidateBackup(text);
      setParsed(result);
      setMode(isLedgerEmpty(ledger) ? "empty" : "merge");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function handleRestore() {
    if (!parsed || !confirmed) return;
    setError("");
    setStatus("");
    setRestoring(true);
    try {
      await onRestore(parsed.backup, mode);
      setStatus(
        `Restore started for ${plural(parsed.preview.counts.transactions, "transaction")} and ${plural(parsed.preview.counts.accounts, "account")}.`,
      );
      setParsed(null);
      setFileName("");
      setConfirmed(false);
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="data-backup" aria-labelledby="data-backup-heading">
      <div className="data-backup-head">
        <div>
          <h3 id="data-backup-heading">Data &amp; backup</h3>
          <p className="muted small">
            Export your transactions as CSV or download a full JSON backup
            (accounts, categories, transactions, recurring schedules,
            occurrences, preferences, budgets, and CSV presets). AI learning
            logs and settings are excluded for privacy.
          </p>
        </div>
      </div>

      <div className="data-backup-actions">
        <button
          type="button"
          className="secondary"
          disabled={disabled || ledger.transactions.length === 0}
          onClick={() => void handleExportCsv()}
        >
          <FileSpreadsheet size={15} /> Export transactions (CSV)
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => void handleExportJson()}
        >
          <FileJson size={15} /> <Download size={14} /> Full backup (JSON)
        </button>
      </div>

      <div className="data-backup-restore">
        <label className="data-backup-file">
          <span>Restore from JSON backup</span>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            disabled={disabled}
            onChange={(e) => void handleFileSelect(e.target.files?.[0])}
          />
        </label>

        {parsed && (
          <div className="data-backup-preview">
            <div className="data-backup-preview-head">
              <strong>{fileName || "Backup preview"}</strong>
              <span className="muted small">
                Format v{parsed.preview.formatVersion} · Exported{" "}
                {parsed.preview.exportedAt.slice(0, 10)}
              </span>
            </div>
            <ul className="data-backup-counts">
              <li>{plural(parsed.preview.counts.accounts, "account")}</li>
              <li>{plural(parsed.preview.counts.categories, "category", "categories")}</li>
              <li>{plural(parsed.preview.counts.transactions, "transaction")}</li>
              <li>{plural(parsed.preview.counts.recurring, "recurring schedule")}</li>
              <li>{plural(parsed.preview.counts.recurringOccurrences, "occurrence")}</li>
              <li>{plural(parsed.preview.counts.budgets, "budget")}</li>
              <li>{plural(parsed.preview.counts.csvPresets, "CSV preset")}</li>
            </ul>

            <fieldset className="data-backup-modes">
              <legend>Restore mode</legend>
              <label className={!workspaceEmpty ? "is-disabled" : ""}>
                <input
                  type="radio"
                  name="restore-mode"
                  value="empty"
                  disabled={disabled || !workspaceEmpty}
                  checked={mode === "empty"}
                  onChange={() => setMode("empty")}
                />
                <span>
                  Restore into empty account only
                  {!workspaceEmpty && (
                    <small className="muted">
                      {" "}
                      (Unavailable — workspace already has data)
                    </small>
                  )}
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="restore-mode"
                  value="merge"
                  disabled={disabled}
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                />
                <span>
                  Merge with existing data (reuses matching accounts &amp;
                  categories, skips duplicate transactions)
                </span>
              </label>
            </fieldset>

            <label className="data-backup-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={disabled}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I have reviewed the preview counts and want to restore this
                backup.
              </span>
            </label>

            <div className="data-backup-restore-actions">
              <button
                type="button"
                className="primary"
                disabled={disabled || !confirmed}
                onClick={() => void handleRestore()}
              >
                <Upload size={15} />{" "}
                {restoring ? "Restoring…" : "Confirm & restore"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => {
                  setParsed(null);
                  setFileName("");
                  setConfirmed(false);
                  setError("");
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="muted small" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
