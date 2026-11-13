import { useEffect, useState, type ReactNode } from "react";
import {
  presetKey,
  type CsvPreset,
  type MissingPresetColumn,
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

export function CsvPresetBar({
  presets,
  presetsState,
  presetBusy,
  presetScope,
  activePreset,
  activePresetName,
  suggestedPreset,
  canSavePreset,
  renaming,
  presetError,
  presetStatus,
  activeMissing,
  missingNotice,
  onApplySuggested,
  onDismissSuggested,
  onSelectPreset,
  onStartRename,
  onCancelRename,
  onRenamePreset,
  onDeletePreset,
  onSavePreset,
  onClearPresetError,
  onRetryLoad,
}: {
  presets: CsvPreset[];
  presetsState: "loading" | "ready" | "failed";
  presetBusy: boolean;
  presetScope: "account" | "browser";
  activePreset: CsvPreset | null;
  activePresetName: string;
  suggestedPreset: CsvPreset | null;
  canSavePreset: boolean;
  renaming: boolean;
  presetError: string;
  presetStatus: string;
  activeMissing: MissingPresetColumn[];
  missingNotice: {
    presetName: string;
    missing: MissingPresetColumn[];
  } | null;
  onApplySuggested: (preset: CsvPreset) => void;
  onDismissSuggested: () => void;
  onSelectPreset: (name: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRenamePreset: (name: string) => void;
  onDeletePreset: () => void;
  onSavePreset: (name: string) => void;
  onClearPresetError: () => void;
  onRetryLoad: () => void;
}) {
  const presetsReady = presetsState === "ready";
  return (
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
                onClick={() => onApplySuggested(suggestedPreset)}
              >
                Apply
              </button>
              <button
                type="button"
                className="secondary"
                onClick={onDismissSuggested}
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
              onChange={(e) => onSelectPreset(e.target.value)}
            >
              <option value="">
                {presetsState === "loading" ? "Loading presets…" : "No preset"}
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
                onClick={onStartRename}
              >
                Rename
              </button>
              <button
                type="button"
                className="secondary"
                onClick={onDeletePreset}
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
            onSubmit={onRenamePreset}
            onEdit={() => {
              if (presetError) onClearPresetError();
            }}
          >
            <button
              type="button"
              className="secondary"
              onClick={onCancelRename}
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
                ? presets.find((p) => presetKey(p.name) === presetKey(name))
                : undefined;
              return match ? `Replace "${match.name}"` : "Save preset";
            }}
            submitClass="secondary"
            onSubmit={onSavePreset}
            onEdit={() => {
              if (presetError) onClearPresetError();
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
        <button type="button" className="secondary" onClick={onRetryLoad}>
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
          {activeMissing.map((m) => `"${m.savedName}" (${m.label})`).join(", ")}
          . Choose {activeMissing.length === 1 ? "a column" : "columns"} below;
          required columns must be mapped to import, and optional ones stay
          blank if left unmapped.
        </p>
      )}
    </div>
  );
}
