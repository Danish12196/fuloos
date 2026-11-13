import { ImportProgress } from "./ImportProgress";
import { confirmDialog } from "./dialogStore";
import type { Category } from "./domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { validateTransaction, type Ledger } from "./domain";
import {
  parseCsv,
  previewCsv,
  transactionKey,
  type CsvOptions,
  type ImportTransaction,
} from "./csv";
import type { Transaction } from "./domain";
import {
  appliedMatches,
  findTransferMatches,
  pairedTransfer,
  type TransferDecision,
  type TransferMatch,
} from "./transferMatch";
import {
  buildPreset,
  presetKey,
  resolvePreset,
  suggestPreset,
  type CsvPreset,
  type MissingPresetColumn,
  type PresetStore,
} from "./csvPresets";
import { CsvPresetBar } from "./CsvPresetBar";
import { CsvReviewSection } from "./CsvReviewSection";
import { CsvMissingCategories } from "./CsvMissingCategories";
import { ImportModalShell } from "./ImportModalShell";

export function CsvImport({
  ledger,
  onClose,
  onImport,
  onCreateCategory,
  onCreateCategories,
  presetStore,
}: {
  ledger: Ledger;
  presetStore: PresetStore;
  onCreateCategories: (
    values: Omit<Category, "id">[],
    progress: (saved: number) => void,
  ) => Promise<void>;
  onCreateCategory: (value: Omit<Category, "id">) => Promise<void>;
  onClose: () => void;
  onImport: (
    rows: ImportTransaction[],
    /** Existing transactions that become transfers because their other leg is in this file. */
    paired: Transaction[],
  ) => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [manualCategories, setManualCategories] = useState(false);
  const [creatingAll, setCreatingAll] = useState(false);
  const [categoryCounts, setCategoryCounts] = useState({ saved: 0, total: 0 });
  const [categoryProgress, setCategoryProgress] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(""),
    [filename, setFilename] = useState(""),
    [delimiter, setDelimiter] = useState(","),
    [header, setHeader] = useState(true),
    [skip, setSkip] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [excluded, setExcluded] = useState<Set<number>>(new Set()),
    [includeDuplicates, setIncludeDuplicates] = useState(false),
    [decisions, setDecisions] = useState<Map<number, TransferDecision>>(
      new Map(),
    ),
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
  const [presets, setPresets] = useState<CsvPreset[]>([]);
  const [presetsState, setPresetsState] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetScope, setPresetScope] = useState(presetStore.scope());
  const [activePresetName, setActivePresetName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [presetError, setPresetError] = useState("");
  const [presetStatus, setPresetStatus] = useState("");
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [missingNotice, setMissingNotice] = useState<{
    presetName: string;
    missing: MissingPresetColumn[];
  } | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const loadAttempt = useRef(0);
  function loadPresetList() {
    const attempt = ++loadAttempt.current;
    setPresetsState("loading");
    setPresetError("");
    presetStore
      .load()
      .then((result) => {
        if (attempt !== loadAttempt.current) return;
        setPresets(result.presets);
        setPresetScope(presetStore.scope());
        setPresetsState("ready");
        if (result.notice) setPresetStatus(result.notice);
      })
      .catch((e) => {
        if (attempt !== loadAttempt.current) return;
        setPresetsState("failed");
        setPresetError(`Could not load presets. ${(e as Error).message}`);
      });
  }
  useEffect(() => {
    loadPresetList();
    return () => {
      loadAttempt.current++;
    };
  }, [presetStore]);

  const { rows, parseError } = useMemo(() => {
    try {
      return {
        rows: text ? parseCsv(text, delimiter).slice(skip) : [],
        parseError: "",
      };
    } catch (e) {
      return { rows: [] as string[][], parseError: (e as Error).message };
    }
  }, [text, delimiter, skip]);
  const firstRow = rows[0];
  const columns =
    firstRow?.map((v, i) =>
      header ? `${v || "Unnamed"} (${i + 1})` : `Column ${i + 1}`,
    ) ?? [];
  const data = useMemo(() => (header ? rows.slice(1) : rows), [rows, header]);
  // Rows the user set by hand in the table keep their choice; the rest are
  const accountById = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a])),
    [ledger.accounts],
  );
  const basePreview = useMemo(
    () => previewCsv(data, options, ledger),
    [data, options, ledger],
  );
  // checked against the ledger for the other side of a transfer.
  const { matches, matchRows } = useMemo(() => {
    const manual = options.transfers ?? {};
    const base = basePreview.filter((r) => !(r.index in manual));
    const matches = findTransferMatches(base, options.account, ledger);
    const wanted = new Set(matches.map((m) => m.index));
    return {
      matches,
      matchRows: new Map(
        base.flatMap((r) =>
          r.transaction && wanted.has(r.index)
            ? [[r.index, r.transaction] as const]
            : [],
        ),
      ),
    };
  }, [basePreview, options.transfers, options.account, ledger]);
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
  const transfers = useMemo<Record<number, string>>(
    () => ({
      ...Object.fromEntries(applied.map((m) => [m.index, m.otherAccount])),
      ...(options.transfers ?? {}),
    }),
    [applied, options.transfers],
  );
  const preview = useMemo(() => {
    if (!applied.length) return basePreview;
    const recorded = new Set(
      applied.filter((m) => m.kind === "recorded").map((m) => m.index),
    );
    const seen = new Set(ledger.transactions.map(transactionKey));
    return basePreview.map((r) => {
      const m = appliedByIndex.get(r.index);
      let next = r;
      if (m && r.transaction && r.transaction.type !== "transfer") {
        const isCredit =
          r.transaction.type === "income" && r.transaction.amount > 0;
        const tx: ImportTransaction = {
          ...r.transaction,
          account_id: isCredit ? m.otherAccount : options.account,
          to_account_id: isCredit ? options.account : m.otherAccount,
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
  }, [basePreview, applied, appliedByIndex, options.account, ledger]);
  const pendingMatches = useMemo(
    () =>
      matches.filter(
        (m) => m.confidence === "likely" && !decisions.has(m.index),
      ),
    [matches, decisions],
  );
  function decide(indexes: number[], decision: TransferDecision) {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const i of indexes) next.set(i, decision);
      return next;
    });
  }
  function resetRowChoices() {
    setExcluded(new Set());
    setDecisions(new Map());
  }
  const accountName = (id: string) =>
    accountById.get(id)?.name ?? "another account";
  /** "to Liv Bank" for money leaving the import account, "from …" otherwise. */
  function direction(m: TransferMatch) {
    const out =
      m.counterpart?.type === "income" ||
      (m.counterpart?.type === "transfer" &&
        m.counterpart.account_id === options.account) ||
      (!m.counterpart && rowOut(m.index));
    return `${out ? "to" : "from"} ${accountName(m.otherAccount)}`;
  }
  function rowOut(index: number) {
    const t = matchRows.get(index);
    return t ? t.type === "expense" : false;
  }
  function matchLabel(m: TransferMatch) {
    if (m.kind === "recorded")
      return `Already recorded as a transfer ${direction(m)}`;
    if (m.kind === "pair")
      return `Transfer ${direction(m)} · completes the ${accountName(m.otherAccount)} entry of ${m.counterpart?.date}`;
    return `Transfer ${direction(m)}`;
  }

  const activePreset = activePresetName
    ? (presets.find((p) => presetKey(p.name) === presetKey(activePresetName)) ??
      null)
    : null;
  const suggestedPreset = useMemo(
    () =>
      suggestionDismissed ||
      (activePreset && suggestPreset([activePreset], text))
        ? null
        : suggestPreset(presets, text),
    [presets, text, suggestionDismissed, activePreset],
  );
  const presetsReady = presetsState === "ready";
  const canSavePreset = presetsReady && !!firstRow && !parseError;
  const activeMissing = missingNotice
    ? missingNotice.missing.filter((m) => {
        if (m.field === "amount" && options.split) return false;
        if ((m.field === "debit" || m.field === "credit") && !options.split)
          return false;
        return options[m.field] < 0;
      })
    : [];

  function applyPreset(preset: CsvPreset, csvText: string) {
    const resolved = resolvePreset(preset, csvText);
    setActivePresetName(preset.name);
    setRenaming(false);
    setPresetError("");
    setPresetStatus("");
    setDelimiter(preset.delimiter);
    setHeader(preset.header);
    setSkip(preset.skip);
    setOptions((o) => ({
      ...resolved.options,
      account: o.account,
      transfers: {},
    }));
    resetRowChoices();
    setMissingNotice(
      csvText && resolved.missing.length
        ? { presetName: preset.name, missing: resolved.missing }
        : null,
    );
  }

  function selectPreset(name: string) {
    setPresetError("");
    setPresetStatus("");
    setRenaming(false);
    if (!name) {
      setActivePresetName("");
      setMissingNotice(null);
      return;
    }
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    if (
      suggestedPreset &&
      presetKey(suggestedPreset.name) === presetKey(preset.name)
    ) {
      setSuggestionDismissed(true);
    }
    applyPreset(preset, text);
  }

  async function handleSavePreset(name: string) {
    if (!canSavePreset || !firstRow || presetBusy) return;
    setPresetBusy(true);
    try {
      const preset = buildPreset({
        name,
        delimiter,
        header,
        skip,
        firstRow,
        options,
      });
      const result = await presetStore.save(preset);
      setPresets(result.presets);
      setActivePresetName(preset.name);
      setRenaming(false);
      setPresetError("");
      setMissingNotice(null);
      setPresetStatus(
        result.replaced
          ? `Replaced preset "${preset.name}".`
          : `Saved preset "${preset.name}".`,
      );
    } catch (e) {
      setPresetError((e as Error).message);
      setPresetStatus("");
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleRenamePreset(name: string) {
    if (!activePreset || presetBusy) return;
    setPresetBusy(true);
    try {
      const oldName = activePreset.name;
      const nextName = name.trim();
      setPresets(await presetStore.rename(oldName, name));
      setActivePresetName(nextName);
      setMissingNotice((prev) =>
        prev && presetKey(prev.presetName) === presetKey(oldName)
          ? { ...prev, presetName: nextName }
          : prev,
      );
      setRenaming(false);
      setPresetError("");
      setPresetStatus(`Renamed preset to "${nextName}".`);
    } catch (e) {
      setPresetError((e as Error).message);
      setPresetStatus("");
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleDeletePreset() {
    if (!activePreset || presetBusy) return;
    const targetName = activePreset.name;
    const ok = await confirmDialog({
      title: `Delete preset "${targetName}"?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete preset",
      tone: "danger",
    });
    if (!ok) return;
    setPresetBusy(true);
    try {
      setPresets(await presetStore.remove(targetName));
      setActivePresetName("");
      setMissingNotice(null);
      setRenaming(false);
      setPresetError("");
      setPresetStatus(`Deleted preset "${targetName}".`);
    } catch (e) {
      setPresetError((e as Error).message);
      setPresetStatus("");
    } finally {
      setPresetBusy(false);
    }
  }

  const missingCategories = useMemo(() => {
    const missingByName = new Map<string, string>();
    const existingNames = new Set(
      ledger.categories.map((c) => c.name.toLowerCase()),
    );
    data.forEach((row, index) => {
      const name = (row[options.category] ?? "").trim();
      const key = name.toLowerCase();
      if (
        name &&
        !transfers[index] &&
        !existingNames.has(key) &&
        !missingByName.has(key)
      ) {
        missingByName.set(key, name);
      }
    });
    return [...missingByName.values()];
  }, [data, options.category, transfers, ledger.categories]);
  async function createAllCategories() {
    if (busy) return;
    const names = [...missingCategories];
    if (names.some((name) => name.length > 80)) {
      setError(
        "Category names must be at most 80 characters. Correct the longer names in your CSV first.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setCreating(null);
    setCreatingAll(true);
    setCategoryCounts({ saved: 0, total: names.length });
    let saved = 0;
    try {
      setCategoryProgress(`Creating ${names.length} categories…`);
      await onCreateCategories(
        names.map((name) => ({
          name,
          description: "",
          emoji: "",
          color: `#${Math.floor(Math.random() * 16777216)
            .toString(16)
            .padStart(6, "0")}`,
        })),
        (count) => {
          saved = count;
          setCategoryCounts({ saved: count, total: names.length });
          setCategoryProgress(
            `Created ${count} of ${names.length} categories…`,
          );
        },
      );
      setCategoryProgress(
        `Created ${saved} categories. You can customize them later in Categories.`,
      );
    } catch (e) {
      setCategoryProgress(`Created ${saved} of ${names.length} categories.`);
      setError(
        `${(e as Error).message} Category creation stopped. Saved categories are kept. If a request timed out, reload the ledger before retrying.`,
      );
    } finally {
      setBusy(false);
      setCreatingAll(false);
    }
  }
  const visible = preview.filter(
    (r) =>
      filter === "all" ||
      (filter === "invalid"
        ? !!r.error
        : filter === "transfers"
          ? matchByIndex.has(r.index)
          : filter === "duplicates"
            ? r.duplicate
            : !!r.transaction &&
              !excluded.has(r.index) &&
              (!r.duplicate || includeDuplicates)),
  );
  const selected = preview.filter(
    (r) =>
      r.transaction &&
      !excluded.has(r.index) &&
      (!r.duplicate || includeDuplicates),
  );
  function change<K extends keyof CsvOptions>(key: K, value: CsvOptions[K]) {
    setOptions((o) => ({
      ...o,
      [key]: value,
      ...(key === "account" ? { transfers: {} } : {}),
    }));
    if (key === "transfers") setExcluded(new Set());
    else resetRowChoices();
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
    setPresetError("");
    setPresetStatus("");
    setReading(true);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose a CSV smaller than 5 MB.");
      const value = await file.text();
      setText(value);
      setSuggestionDismissed(false);
      setFilename(file.name);
      setCategoryProgress("");
      setCategoryCounts({ saved: 0, total: 0 });
      setCreating(null);
      if (activePreset) {
        applyPreset(activePreset, value);
        setPresetStatus(
          `Re-applied preset "${activePreset.name}" to ${file.name}. Manual changes were reset.`,
        );
      } else {
        setOptions((o) => ({ ...o, transfers: {} }));
        setMissingNotice(null);
        resetRowChoices();
      }
    } catch (e) {
      setError((e as Error).message);
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
        ? [pairedTransfer(m.counterpart, options.account)]
        : [];
    });
    setBusy(true);
    setError("");
    try {
      await onImport(
        creates.map((r) => r.transaction!),
        paired,
      );
      // Saving continues in the background queue.
      onClose();
    } catch (e) {
      setError(
        `${(e as Error).message} Import stopped. Successfully saved rows are excluded; review before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ImportModalShell
      dialogRef={dialog}
      className="modal csv-modal"
      titleId="csv-title"
      eyebrow="BRING YOUR MONEY INTO VIEW"
      title="Import CSV"
      closeLabel="Close import"
      busy={busy}
      onClose={onClose}
      actions={
        <>
          {categoryCounts.total > 0 && (
            <ImportProgress
              label="Categories created"
              value={categoryCounts.saved}
              total={categoryCounts.total}
            />
          )}
          {reading && (
            <div className="import-progress">
              <p role="status">Reading CSV file…</p>
              <progress aria-label="Reading CSV file" />
            </div>
          )}
          <button className="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || reading || !!parseError || !selected.length}
            onClick={() => void submit()}
          >
            {busy
              ? creatingAll || creating
                ? "Creating categories…"
                : "Importing…"
              : `Import ${selected.length} transactions`}
          </button>
        </>
      }
    >
        <p className="muted">
          Choose a bank CSV, match its columns, then review before importing.
          Amounts are in AED. Mark transfers below and choose the other account.
          Positive amounts arrive in the import account; negative amounts leave
          it.
        </p>
        <fieldset disabled={busy || reading}>
          <CsvPresetBar
            presets={presets}
            presetsState={presetsState}
            presetBusy={presetBusy}
            presetScope={presetScope}
            activePreset={activePreset}
            activePresetName={activePresetName}
            suggestedPreset={suggestedPreset}
            canSavePreset={canSavePreset}
            renaming={renaming}
            presetError={presetError}
            presetStatus={presetStatus}
            activeMissing={activeMissing}
            missingNotice={missingNotice}
            onApplySuggested={(preset) => {
              applyPreset(preset, text);
              setSuggestionDismissed(true);
            }}
            onDismissSuggested={() => setSuggestionDismissed(true)}
            onSelectPreset={selectPreset}
            onStartRename={() => {
              setRenaming(true);
              setPresetError("");
              setPresetStatus("");
            }}
            onCancelRename={() => {
              setRenaming(false);
              setPresetError("");
            }}
            onRenamePreset={handleRenamePreset}
            onDeletePreset={handleDeletePreset}
            onSavePreset={handleSavePreset}
            onClearPresetError={() => setPresetError("")}
            onRetryLoad={loadPresetList}
          />
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
                  setOptions((o) => ({ ...o, transfers: {} }));
                  resetRowChoices();
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
                  setOptions((o) => ({ ...o, transfers: {} }));
                  resetRowChoices();
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
                setOptions((o) => ({ ...o, transfers: {} }));
                resetRowChoices();
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
              {mapping("category", "Category")}
            </div>
          )}
          <p className="muted small">
            Signed amounts: negative = expense, positive = income. Debit/credit
            amounts must be zero or positive. Unmapped categories stay
            uncategorized.
          </p>
        </fieldset>
        <CsvMissingCategories
          missingCategories={missingCategories}
          busy={busy}
          reading={reading}
          manualCategories={manualCategories}
          creating={creating}
          onToggleManual={() => setManualCategories((value) => !value)}
          onSetCreating={setCreating}
          onCreateAll={() => void createAllCategories()}
          onCreateOne={async (value) => {
            setBusy(true);
            setError("");
            try {
              await onCreateCategory(value);
              setCreating(null);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        {categoryProgress && <p role="status">{categoryProgress}</p>}
        {(parseError || error) && (
          <p role="alert" className="notice">
            {parseError || error}
          </p>
        )}
        <CsvReviewSection
          ledger={ledger}
          data={data}
          options={options}
          skip={skip}
          header={header}
          busy={busy}
          parseError={parseError}
          preview={preview}
          visible={visible}
          selected={selected}
          filter={filter}
          includeDuplicates={includeDuplicates}
          excluded={excluded}
          matches={matches}
          matchRows={matchRows}
          pendingMatches={pendingMatches}
          applied={applied}
          appliedByIndex={appliedByIndex}
          matchByIndex={matchByIndex}
          transfers={transfers}
          accountById={accountById}
          matchLabel={matchLabel}
          onDecide={decide}
          onSetFilter={setFilter}
          onSetIncludeDuplicates={setIncludeDuplicates}
          onToggleExcluded={(index, checked) =>
            setExcluded((prev) => {
              const next = new Set(prev);
              if (checked) next.delete(index);
              else next.add(index);
              return next;
            })
          }
          onChangeTransfers={(next) => change("transfers", next)}
        />
    </ImportModalShell>
  );
}
