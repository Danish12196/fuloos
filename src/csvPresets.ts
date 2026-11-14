// Presets are stored per account in PocketBase (fuloos_csv_presets) when signed in.
// localStorage is used in demo mode, when no backend is configured, and as a
// fallback until the server migration is installed. Presets left in
// localStorage by older versions are uploaded to the account on first load.
import { parseCsv, type CsvOptions } from "./csv.ts";
import { plural } from "./domain.ts";

export const PRESET_STORAGE_KEY = "fuloos-csv-presets";
export const MAX_PRESET_NAME_LENGTH = 80;
export const MAX_PRESET_SKIP = 10000;

type CsvDelimiter = "," | ";" | "\t" | "|";

type PresetColumnKey =
  | "date"
  | "payee"
  | "notes"
  | "category"
  | "amount"
  | "debit"
  | "credit";

const PRESET_COLUMN_KEYS: readonly PresetColumnKey[] = [
  "date",
  "payee",
  "notes",
  "category",
  "amount",
  "debit",
  "credit",
];

const COLUMN_LABELS: Record<PresetColumnKey, string> = {
  date: "Date",
  payee: "Payee / description",
  notes: "Notes",
  category: "Category",
  amount: "Amount",
  debit: "Debit / money out",
  credit: "Credit / money in",
};

interface PresetColumn {
  index: number;
  name: string;
}

type PresetColumns = Record<PresetColumnKey, PresetColumn | null>;

export interface CsvPreset {
  name: string;
  delimiter: CsvDelimiter;
  header: boolean;
  skip: number;
  split: boolean;
  flip: boolean;
  decimal: "." | ",";
  dateFormat: "DMY" | "MDY" | "YMD";
  headers: string[];
  columns: PresetColumns;
}

type PresetMappedOptions = Omit<CsvOptions, "account" | "transfers">;

export interface MissingPresetColumn {
  field: PresetColumnKey;
  label: string;
  savedName: string;
}

interface ResolvedPreset {
  options: PresetMappedOptions;
  missing: MissingPresetColumn[];
}

export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const STORAGE_WRITE_ERROR =
  "The preset change could not be saved because browser storage is full or unavailable.";

interface PresetWriteResult {
  presets: CsvPreset[];
  persisted: boolean;
  replaced?: boolean;
}

export function presetKey(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeHeaderName(value: string): string {
  return value.trim().toLowerCase();
}

function isCsvDelimiter(value: unknown): value is CsvDelimiter {
  return value === "," || value === ";" || value === "\t" || value === "|";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePresetEntry(value: unknown): CsvPreset | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.name !== "string") return null;
  const name = value.name.trim();
  if (!name || name.length > MAX_PRESET_NAME_LENGTH) return null;
  if (!isCsvDelimiter(value.delimiter)) return null;
  if (typeof value.header !== "boolean") return null;
  if (
    typeof value.skip !== "number" ||
    !Number.isInteger(value.skip) ||
    value.skip < 0 ||
    value.skip > MAX_PRESET_SKIP
  )
    return null;
  if (typeof value.split !== "boolean" || typeof value.flip !== "boolean")
    return null;
  if (value.decimal !== "." && value.decimal !== ",") return null;
  if (
    value.dateFormat !== "DMY" &&
    value.dateFormat !== "MDY" &&
    value.dateFormat !== "YMD"
  )
    return null;
  if (
    !Array.isArray(value.headers) ||
    !value.headers.every((h) => typeof h === "string")
  )
    return null;
  if (!isPlainObject(value.columns)) return null;

  const columns = {} as PresetColumns;
  for (const key of PRESET_COLUMN_KEYS) {
    const entry = value.columns[key];
    if (entry === null) {
      columns[key] = null;
    } else if (
      isPlainObject(entry) &&
      typeof entry.index === "number" &&
      Number.isSafeInteger(entry.index) &&
      entry.index >= 0 &&
      typeof entry.name === "string"
    ) {
      columns[key] = {
        index: entry.index,
        name: entry.name,
      };
    } else {
      return null;
    }
  }

  return {
    name,
    delimiter: value.delimiter,
    header: value.header,
    skip: value.skip,
    split: value.split,
    flip: value.flip,
    decimal: value.decimal,
    dateFormat: value.dateFormat,
    headers: [...value.headers],
    columns,
  };
}

export function loadPresets(storage?: PresetStorage | null): CsvPreset[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(PRESET_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (
    !isPlainObject(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.presets)
  )
    return [];

  const result: CsvPreset[] = [];
  const seen = new Set<string>();
  for (const item of parsed.presets) {
    const valid = parsePresetEntry(item);
    if (!valid) continue;
    const key = presetKey(valid.name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(valid);
  }
  return result;
}

export function validatePresetName(
  name: string,
  existing: readonly CsvPreset[] = [],
  options?: { excludeName?: string },
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a preset name.";
  if (trimmed.length > MAX_PRESET_NAME_LENGTH)
    return `Preset names must contain 1–${MAX_PRESET_NAME_LENGTH} characters.`;
  const key = presetKey(trimmed);
  const excludeKey =
    options?.excludeName !== undefined ? presetKey(options.excludeName) : null;
  if (
    existing.some(
      (p) => presetKey(p.name) === key && presetKey(p.name) !== excludeKey,
    )
  )
    return "A preset with this name already exists.";
  return null;
}

export function buildPreset(input: {
  name: string;
  delimiter: string;
  header: boolean;
  skip: number;
  firstRow: readonly string[];
  options: Pick<
    CsvOptions,
    | "date"
    | "payee"
    | "notes"
    | "category"
    | "amount"
    | "debit"
    | "credit"
    | "split"
    | "flip"
    | "decimal"
    | "dateFormat"
  >;
}): CsvPreset {
  const nameError = validatePresetName(input.name);
  if (nameError) throw new Error(nameError);
  if (!isCsvDelimiter(input.delimiter))
    throw new Error("Choose a supported delimiter.");
  if (
    typeof input.skip !== "number" ||
    !Number.isInteger(input.skip) ||
    input.skip < 0 ||
    input.skip > MAX_PRESET_SKIP
  )
    throw new Error(
      `Skip leading rows must be a whole number from 0 to ${MAX_PRESET_SKIP}.`,
    );
  const columnCount = input.firstRow.length;
  if (columnCount === 0)
    throw new Error("Load a CSV file with columns before saving a preset.");

  const columns = {} as PresetColumns;
  for (const key of PRESET_COLUMN_KEYS) {
    const index = input.options[key];
    if (Number.isSafeInteger(index) && index >= 0 && index < columnCount) {
      columns[key] = {
        index,
        name: input.header ? input.firstRow[index] : `Column ${index + 1}`,
      };
    } else {
      columns[key] = null;
    }
  }

  return {
    name: input.name.trim(),
    delimiter: input.delimiter,
    header: input.header,
    skip: input.skip,
    split: input.options.split,
    flip: input.options.flip,
    decimal: input.options.decimal,
    dateFormat: input.options.dateFormat,
    headers: input.header ? [...input.firstRow] : [],
    columns,
  };
}

function writePresets(
  storage: PresetStorage | null | undefined,
  presets: CsvPreset[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      PRESET_STORAGE_KEY,
      JSON.stringify({ version: 1, presets }),
    );
    return true;
  } catch {
    return false;
  }
}

export function savePreset(
  storage: PresetStorage | null | undefined,
  preset: CsvPreset,
): PresetWriteResult {
  const valid = parsePresetEntry(preset);
  if (!valid) throw new Error("Invalid preset configuration.");

  const base = loadPresets(storage);
  const key = presetKey(valid.name);
  const existingIndex = base.findIndex((p) => presetKey(p.name) === key);
  const replaced = existingIndex >= 0;
  const presets = replaced
    ? base.map((p, i) => (i === existingIndex ? valid : p))
    : [...base, valid];
  const persisted = writePresets(storage, presets);
  return { presets: persisted ? presets : base, persisted, replaced };
}

export function renamePreset(
  storage: PresetStorage | null | undefined,
  oldName: string,
  newName: string,
): PresetWriteResult {
  const base = loadPresets(storage);
  const nameError = validatePresetName(newName, base, { excludeName: oldName });
  if (nameError) throw new Error(nameError);
  const oldKey = presetKey(oldName);
  const index = base.findIndex((p) => presetKey(p.name) === oldKey);
  if (index < 0) throw new Error("Preset not found.");
  const updated: CsvPreset = { ...base[index], name: newName.trim() };
  const presets = base.map((p, i) => (i === index ? updated : p));
  const persisted = writePresets(storage, presets);
  return { presets: persisted ? presets : base, persisted };
}

export function deletePreset(
  storage: PresetStorage | null | undefined,
  name: string,
): PresetWriteResult {
  const base = loadPresets(storage);
  const key = presetKey(name);
  const presets = base.filter((p) => presetKey(p.name) !== key);
  const persisted = writePresets(storage, presets);
  return { presets: persisted ? presets : base, persisted };
}

function relevantKeysForMode(split: boolean): PresetColumnKey[] {
  return split
    ? ["date", "debit", "credit", "payee", "notes", "category"]
    : ["date", "amount", "payee", "notes", "category"];
}

export function resolvePreset(
  preset: CsvPreset,
  csvText: string,
): ResolvedPreset {
  let firstRow: string[] | undefined;
  if (csvText) {
    try {
      const rows = parseCsv(csvText, preset.delimiter);
      firstRow = rows.slice(preset.skip)[0];
    } catch {
      firstRow = undefined;
    }
  }

  const normalizedHeaders =
    preset.header && firstRow ? firstRow.map(normalizeHeaderName) : null;

  const options: PresetMappedOptions = {
    date: -1,
    payee: -1,
    notes: -1,
    category: -1,
    amount: -1,
    debit: -1,
    credit: -1,
    split: preset.split,
    flip: preset.flip,
    decimal: preset.decimal,
    dateFormat: preset.dateFormat,
  };

  const missing: MissingPresetColumn[] = [];
  const relevantKeys = relevantKeysForMode(preset.split);

  for (const key of relevantKeys) {
    const saved = preset.columns[key];
    if (!saved) continue;

    let resolvedIndex = -1;
    if (firstRow) {
      if (preset.header && normalizedHeaders) {
        const target = normalizeHeaderName(saved.name);
        if (normalizedHeaders[saved.index] === target) {
          resolvedIndex = saved.index;
        } else {
          const first = normalizedHeaders.indexOf(target);
          if (first >= 0 && first === normalizedHeaders.lastIndexOf(target)) {
            resolvedIndex = first;
          }
        }
      } else if (
        !preset.header &&
        saved.index >= 0 &&
        saved.index < firstRow.length
      ) {
        resolvedIndex = saved.index;
      }
    }

    options[key] = resolvedIndex;
    if (resolvedIndex < 0) {
      missing.push({
        field: key,
        label: COLUMN_LABELS[key],
        savedName: saved.name.trim() || `Column ${saved.index + 1}`,
      });
    }
  }

  return { options, missing };
}

export function suggestPreset(
  presets: readonly CsvPreset[],
  csvText: string,
): CsvPreset | null {
  if (!csvText || !presets.length) return null;

  const maxLimitByDelimiter = new Map<CsvDelimiter, number>();
  for (const preset of presets) {
    if (!preset.header || !preset.headers.length) continue;
    const prev = maxLimitByDelimiter.get(preset.delimiter) ?? 0;
    if (preset.skip + 1 > prev)
      maxLimitByDelimiter.set(preset.delimiter, preset.skip + 1);
  }

  const parsedByDelimiter = new Map<CsvDelimiter, string[][] | null>();
  let multisetMatch: CsvPreset | null = null;

  for (const preset of presets) {
    if (!preset.header || !preset.headers.length) continue;

    let rows = parsedByDelimiter.get(preset.delimiter);
    if (rows === undefined) {
      try {
        rows = parseCsv(csvText, preset.delimiter, {
          limit: maxLimitByDelimiter.get(preset.delimiter),
        });
      } catch {
        rows = null;
      }
      parsedByDelimiter.set(preset.delimiter, rows);
    }
    if (!rows) continue;

    const firstRow = rows.slice(preset.skip)[0];
    if (!firstRow || firstRow.length !== preset.headers.length) continue;

    const fileNorm = firstRow.map(normalizeHeaderName);
    const savedNorm = preset.headers.map(normalizeHeaderName);

    const exactOrder = fileNorm.every((value, i) => value === savedNorm[i]);
    if (exactOrder) return preset;

    if (!multisetMatch) {
      const sortedFile = [...fileNorm].sort();
      const sortedSaved = [...savedNorm].sort();
      if (sortedFile.every((value, i) => value === sortedSaved[i])) {
        multisetMatch = preset;
      }
    }
  }

  return multisetMatch;
}

// ---------------------------------------------------------------------------
// Account-synced presets
// ---------------------------------------------------------------------------

export interface PresetRecord {
  id: string;
  name: string;
  config: unknown;
}

export interface PresetRecordBody {
  name: string;
  name_key: string;
  config: Omit<CsvPreset, "name">;
}

export interface PresetRemote {
  list(): Promise<PresetRecord[]>;
  save(body: PresetRecordBody, id?: string): Promise<PresetRecord>;
  remove(id: string): Promise<void>;
}

export interface PresetLoadResult {
  presets: CsvPreset[];
  notice?: string;
}

export interface PresetStore {
  /** "account" when presets sync to the signed-in user, "browser" otherwise. */
  readonly scope: () => "account" | "browser";
  load(): Promise<PresetLoadResult>;
  save(preset: CsvPreset): Promise<{ presets: CsvPreset[]; replaced: boolean }>;
  rename(oldName: string, newName: string): Promise<CsvPreset[]>;
  remove(name: string): Promise<CsvPreset[]>;
}

export function presetToRecord(preset: CsvPreset): PresetRecordBody {
  const { name, ...config } = preset;
  return { name: name.trim(), name_key: presetKey(name), config };
}

export function presetFromRecord(record: PresetRecord): CsvPreset | null {
  if (!isPlainObject(record) || typeof record.name !== "string") return null;
  if (!isPlainObject(record.config)) return null;
  return parsePresetEntry({ ...record.config, name: record.name });
}

function sortPresets<T extends { preset: CsvPreset }>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    a.preset.name.localeCompare(b.preset.name, undefined, {
      sensitivity: "base",
    }),
  );
}

/** Replaces the browser copy; an empty list removes the key entirely. */
export function replaceLocalPresets(
  storage: PresetStorage | null | undefined,
  presets: CsvPreset[],
): boolean {
  if (!storage) return false;
  if (presets.length) return writePresets(storage, presets);
  try {
    if (storage.removeItem) storage.removeItem(PRESET_STORAGE_KEY);
    else
      storage.setItem(
        PRESET_STORAGE_KEY,
        JSON.stringify({ version: 1, presets: [] }),
      );
    return true;
  } catch {
    return false;
  }
}

export function createLocalPresetStore(
  storage: PresetStorage | null | undefined,
): PresetStore {
  return {
    scope: () => "browser",
    async load() {
      return { presets: loadPresets(storage) };
    },
    async save(preset) {
      const result = savePreset(storage, preset);
      if (!result.persisted) throw new Error(STORAGE_WRITE_ERROR);
      return { presets: result.presets, replaced: !!result.replaced };
    },
    async rename(oldName, newName) {
      const result = renamePreset(storage, oldName, newName);
      if (!result.persisted) throw new Error(STORAGE_WRITE_ERROR);
      return result.presets;
    },
    async remove(name) {
      const result = deletePreset(storage, name);
      if (!result.persisted) throw new Error(STORAGE_WRITE_ERROR);
      return result.presets;
    },
  };
}

function isMissingCollectionError(e: unknown): boolean {
  return (
    e instanceof Error && e.message.includes("Install the PocketBase migration")
  );
}


/**
 * Presets stored in the user's account. On load, any presets left in browser
 * storage are uploaded (names already in the account win) and then removed from
 * the browser so they are not imported into a different account later. If the
 * server has not been upgraded yet, it falls back to browser storage.
 */
export function createAccountPresetStore(
  remote: PresetRemote,
  storage: PresetStorage | null | undefined,
): PresetStore {
  type Entry = { id: string; preset: CsvPreset };
  let entries: Entry[] = [];
  let fallback: PresetStore | null = null;
  const list = () => entries.map((e) => e.preset);
  const find = (name: string) =>
    entries.find((e) => presetKey(e.preset.name) === presetKey(name));
  const accept = (record: PresetRecord): Entry => {
    const preset = presetFromRecord(record);
    if (!preset) throw new Error("The server returned an invalid preset.");
    return { id: record.id, preset };
  };

  async function migrateLocal(): Promise<string | undefined> {
    const local = loadPresets(storage);
    if (!local.length) return undefined;
    const known = new Set(entries.map((e) => presetKey(e.preset.name)));
    const failed: CsvPreset[] = [];
    let imported = 0;
    let skipped = 0;
    for (const preset of local) {
      const key = presetKey(preset.name);
      if (known.has(key)) {
        skipped++;
        continue;
      }
      try {
        entries.push(accept(await remote.save(presetToRecord(preset))));
        known.add(key);
        imported++;
      } catch {
        failed.push(preset);
      }
    }
    replaceLocalPresets(storage, failed);
    entries = sortPresets(entries);
    const parts: string[] = [];
    if (imported)
      parts.push(
        `Moved ${plural(imported, "preset")} from this browser to your account.`,
      );
    if (skipped)
      parts.push(
        `${plural(skipped, "browser preset")} matched names already in your account and ${skipped === 1 ? "was" : "were"} not copied.`,
      );
    if (failed.length)
      parts.push(
        `${plural(failed.length, "preset")} could not be uploaded and will be retried next time.`,
      );
    return parts.join(" ") || undefined;
  }

  return {
    scope: () => (fallback ? "browser" : "account"),
    async load() {
      let records: PresetRecord[];
      try {
        records = await remote.list();
      } catch (e) {
        if (!isMissingCollectionError(e)) throw e;
        fallback = createLocalPresetStore(storage);
        const result = await fallback.load();
        return {
          ...result,
          notice:
            "Presets are saved in this browser only until the server's preset migration is installed.",
        };
      }
      fallback = null;
      const seen = new Set<string>();
      entries = [];
      for (const record of records) {
        const preset = presetFromRecord(record);
        if (!preset) continue;
        const key = presetKey(preset.name);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ id: record.id, preset });
      }
      entries = sortPresets(entries);
      const notice = await migrateLocal();
      return { presets: list(), notice };
    },
    async save(preset) {
      if (fallback) return fallback.save(preset);
      const valid = parsePresetEntry(preset);
      if (!valid) throw new Error("Invalid preset configuration.");
      const existing = find(valid.name);
      const saved = accept(
        await remote.save(presetToRecord(valid), existing?.id),
      );
      entries = sortPresets(
        existing
          ? entries.map((e) => (e === existing ? saved : e))
          : [...entries, saved],
      );
      return { presets: list(), replaced: !!existing };
    },
    async rename(oldName, newName) {
      if (fallback) return fallback.rename(oldName, newName);
      const nameError = validatePresetName(newName, list(), {
        excludeName: oldName,
      });
      if (nameError) throw new Error(nameError);
      const existing = find(oldName);
      if (!existing) throw new Error("Preset not found.");
      const saved = accept(
        await remote.save(
          presetToRecord({ ...existing.preset, name: newName.trim() }),
          existing.id,
        ),
      );
      entries = sortPresets(entries.map((e) => (e === existing ? saved : e)));
      return list();
    },
    async remove(name) {
      if (fallback) return fallback.remove(name);
      const existing = find(name);
      if (!existing) return list();
      await remote.remove(existing.id);
      entries = entries.filter((e) => e !== existing);
      return list();
    },
  };
}
