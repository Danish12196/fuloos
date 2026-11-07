import { ImportProgress } from "./ImportProgress";
import { confirmDialog } from "./dialogStore";
import { ColorPicker, EmojiField } from "./Appearance";
import type { Category } from "./domain";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { money, type Ledger } from "./domain";
import {
  parseCsv,
  previewCsv,
  type CsvOptions,
  type ImportTransaction,
} from "./csv";
import {
  buildPreset,
  presetKey,
  resolvePreset,
  suggestPreset,
  type CsvPreset,
  type MissingPresetColumn,
  type PresetStore,
} from "./csvPresets";

function PresetNameRow({
  label,
  initial,
  placeholder,
  submitLabel,
  submitClass,
  onSubmit,
  onEdit,
  children,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  submitLabel: (name: string) => string;
  submitClass: string;
  onSubmit: (name: string) => void;
  onEdit: () => void;
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial]);
  return (
    <div className="csv-preset-row">
      <label>
        {label}
        <input
          placeholder={placeholder}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            onEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit(name);
            }
          }}
        />
      </label>
      <button
        type="button"
        className={submitClass}
        onClick={() => onSubmit(name)}
      >
        {submitLabel(name)}
      </button>
      {children}
    </div>
  );
}

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
    progress: (n: number) => void,
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

  let rows: string[][] = [],
    parseError = "";
  try {
    rows = text ? parseCsv(text, delimiter).slice(skip) : [];
  } catch (e) {
    parseError = (e as Error).message;
  }
  const firstRow = rows[0];
  const columns =
    firstRow?.map((v, i) =>
      header ? `${v || "Unnamed"} (${i + 1})` : `Column ${i + 1}`,
    ) ?? [];
  const data = header ? rows.slice(1) : rows;
  const preview = previewCsv(data, options, ledger);

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
    setExcluded(new Set());
    setDone(false);
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

  const missingByName = new Map<string, string>();
  const existingNames = new Set(
    ledger.categories.map((c) => c.name.toLowerCase()),
  );
  data.forEach((row, index) => {
    const name = (row[options.category] ?? "").trim();
    const key = name.toLowerCase();
    if (
      name &&
      !options.transfers?.[index] &&
      !existingNames.has(key) &&
      !missingByName.has(key)
    ) {
      missingByName.set(key, name);
    }
  });
  const missingCategories = [...missingByName.values()];
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
      setProgress(0);
      setTotal(0);
      setCreating(null);
      if (activePreset) {
        applyPreset(activePreset, value);
        setPresetStatus(
          `Re-applied preset "${activePreset.name}" to ${file.name}. Manual changes were reset.`,
        );
      } else {
        setOptions((o) => ({ ...o, transfers: {} }));
        setMissingNotice(null);
        setExcluded(new Set());
        setDone(false);
      }
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
          Amounts are in AED. Mark transfers below and choose the other account.
          Positive amounts arrive in the import account; negative amounts leave
          it.
        </p>
        <fieldset disabled={busy || done || reading}>
          <div className="csv-presets">
            <fieldset disabled={presetBusy || !presetsReady}>
              {suggestedPreset && (
                <div role="status" className="notice csv-preset-banner">
                  <span>
                    Matching preset found: <b>{suggestedPreset.name}</b>
                  </span>
                  <div className="csv-category-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        applyPreset(suggestedPreset, text);
                        setSuggestionDismissed(true);
                      }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSuggestionDismissed(true)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
              <div className="csv-preset-row">
                <label>
                  Mapping preset
                  <select
                    value={activePreset?.name ?? ""}
                    onChange={(e) => selectPreset(e.target.value)}
                  >
                    <option value="">
                      {presetsState === "loading"
                        ? "Loading presets…"
                        : "No preset"}
                    </option>
                    {presets.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {activePreset && !renaming && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setRenaming(true);
                        setPresetError("");
                        setPresetStatus("");
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleDeletePreset}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
              {activePreset && renaming && (
                <PresetNameRow
                  label="New preset name"
                  initial={activePreset.name}
                  submitLabel={() => "Save name"}
                  submitClass="primary"
                  onSubmit={handleRenamePreset}
                  onEdit={() => {
                    if (presetError) setPresetError("");
                  }}
                >
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setRenaming(false);
                      setPresetError("");
                    }}
                  >
                    Cancel
                  </button>
                </PresetNameRow>
              )}
              {canSavePreset && (
                <PresetNameRow
                  label="Preset name"
                  initial={activePresetName}
                  placeholder="e.g. Emirates NBD"
                  submitLabel={(name) => {
                    const match = name.trim()
                      ? presets.find(
                          (p) => presetKey(p.name) === presetKey(name),
                        )
                      : undefined;
                    return match ? `Replace "${match.name}"` : "Save preset";
                  }}
                  submitClass="secondary"
                  onSubmit={handleSavePreset}
                  onEdit={() => {
                    if (presetError) setPresetError("");
                  }}
                />
              )}
            </fieldset>
            {presetsReady && (
              <p className="muted small csv-preset-scope">
                {presetScope === "account"
                  ? "Presets are saved to your account and available on every device."
                  : "Presets are saved in this browser only."}
              </p>
            )}
            {presetError && (
              <p role="alert" className="error">
                {presetError}
              </p>
            )}
            {presetsState === "failed" && (
              <button
                type="button"
                className="secondary"
                onClick={loadPresetList}
              >
                Retry loading presets
              </button>
            )}
            {presetStatus && (
              <p role="status" className="muted small">
                {presetStatus}
              </p>
            )}
            {activeMissing.length > 0 && missingNotice && (
              <p role="alert" className="notice">
                Preset &ldquo;{missingNotice.presetName}&rdquo; could not match{" "}
                {activeMissing
                  .map((m) => `"${m.savedName}" (${m.label})`)
                  .join(", ")}
                . Choose {activeMissing.length === 1 ? "a column" : "columns"}{" "}
                below; required columns must be mapped to import, and optional
                ones stay blank if left unmapped.
              </p>
            )}
          </div>
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
                  setOptions((o) => ({ ...o, transfers: {} }));
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
                setOptions((o) => ({ ...o, transfers: {} }));
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
              {mapping("category", "Category")}
            </div>
          )}
          <p className="muted small">
            Signed amounts: negative = expense, positive = income. Debit/credit
            amounts must be zero or positive. Unmapped categories stay
            uncategorized.
          </p>
        </fieldset>
        {!!missingCategories.length && !done && (
          <section className="missing-categories">
            <h3>Missing categories</h3>
            <p className="muted">
              {missingCategories.length} missing categories. Create them all
              with random colors and blank descriptions and emojis, or configure
              each one yourself.
            </p>
            <div className="csv-category-actions">
              <button
                className="primary"
                disabled={busy || reading}
                onClick={() => void createAllCategories()}
              >
                Create all missing categories
              </button>
              <button
                className="secondary"
                disabled={busy || reading}
                aria-expanded={manualCategories}
                onClick={() => setManualCategories((value) => !value)}
              >
                {manualCategories
                  ? "Hide individual configuration"
                  : "Configure individually"}
              </button>
            </div>
            {manualCategories &&
              missingCategories.map((name) => (
                <div key={name}>
                  <button
                    className="secondary"
                    disabled={busy || reading}
                    onClick={() => setCreating(name)}
                  >
                    Create {name}
                  </button>
                  {creating === name && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        setBusy(true);
                        setError("");
                        try {
                          await onCreateCategory({
                            name,
                            description: String(f.get("description") ?? ""),
                            color: String(f.get("color")),
                            emoji: String(f.get("emoji") ?? ""),
                          });
                          setCreating(null);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <fieldset disabled={busy}>
                        <p>{name}</p>
                        {name.length > 80 && (
                          <p role="alert">
                            Correct this category name in the CSV: maximum 80
                            characters.
                          </p>
                        )}
                        <label>
                          Description (optional)
                          <input name="description" maxLength={500} />
                        </label>
                        <EmojiField />
                        <ColorPicker />
                        <button className="primary" disabled={name.length > 80}>
                          Confirm creation
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setCreating(null)}
                        >
                          Cancel
                        </button>
                      </fieldset>
                    </form>
                  )}
                </div>
              ))}
          </section>
        )}
        {categoryProgress && <p role="status">{categoryProgress}</p>}
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
            <label>
              Show rows
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All rows ({preview.length})</option>
                <option value="invalid">
                  Invalid fields ({preview.filter((r) => r.error).length})
                </option>
                <option value="duplicates">
                  Possible duplicates (
                  {preview.filter((r) => r.duplicate).length})
                </option>
                <option value="selected">Selected ({selected.length})</option>
              </select>
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
                    <th>Type / transfer account</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
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
                      <td>
                        {r.transaction?.date ??
                          data[r.index]?.[options.date] ??
                          "—"}
                      </td>
                      <td>
                        {r.transaction?.payee ||
                          data[r.index]?.[options.payee] ||
                          "—"}
                      </td>
                      <td>
                        {r.transaction
                          ? money(
                              r.transaction.amount *
                                (r.transaction.type === "expense" ? -1 : 1),
                            )
                          : "—"}
                      </td>
                      <td>
                        <select
                          aria-label={`Transfer account for row ${r.index + skip + (header ? 2 : 1)}`}
                          disabled={busy || done}
                          value={options.transfers?.[r.index] ?? ""}
                          onChange={(e) =>
                            change("transfers", {
                              ...options.transfers,
                              [r.index]: e.target.value,
                            })
                          }
                        >
                          <option value="">Income / expense</option>
                          {ledger.accounts
                            .filter((a) => a.id !== options.account)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                Transfer · {a.name}
                              </option>
                            ))}
                        </select>
                        {r.transaction?.type === "transfer" && (
                          <small>
                            {
                              ledger.accounts.find(
                                (a) => a.id === r.transaction?.account_id,
                              )?.name
                            }{" "}
                            →{" "}
                            {
                              ledger.accounts.find(
                                (a) => a.id === r.transaction?.to_account_id,
                              )?.name
                            }
                          </small>
                        )}
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
        {done && (
          <p role="status">Imported {progress} transactions successfully.</p>
        )}
      </div>
      <div className="modal-actions">
        {categoryCounts.total > 0 && total === 0 && (
          <ImportProgress
            label="Categories created"
            value={categoryCounts.saved}
            total={categoryCounts.total}
          />
        )}
        {total > 0 && (
          <ImportProgress
            label="Transactions imported"
            value={progress}
            total={total}
          />
        )}
        {reading && (
          <div className="import-progress">
            <p role="status">Reading CSV file…</p>
            <progress aria-label="Reading CSV file" />
          </div>
        )}

        <button className="secondary" disabled={busy} onClick={onClose}>
          {done ? "Done" : "Cancel"}
        </button>
        {!done && (
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
        )}
      </div>
    </dialog>
  );
}
