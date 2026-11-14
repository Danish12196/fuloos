import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, Power, Trash2, Wand2, X } from "lucide-react";
import {
  errorMessage,
  minor,
  money,
  type Ledger,
  type RuleMatchField,
  type RuleMatchType,
  type TransactionRule,
} from "./domain";
import { collectLedgerTags } from "./enrichment";
import { sortRules, validateRule } from "./rules";
import { TagInput } from "./TagInput";

type RuleDraft = Omit<TransactionRule, "id">;

function emptyDraft(): RuleDraft {
  return {
    name: "",
    enabled: true,
    priority: 100,
    match_field: "either",
    match_type: "contains",
    pattern: "",
    min_amount: null,
    max_amount: null,
    set_category_id: null,
    add_tags: [],
    set_payee: "",
  };
}

export function RulesManagerModal({
  ledger,
  busy,
  onClose,
  onSaveRule,
  onDeleteRule,
}: {
  ledger: Ledger;
  busy: boolean;
  onClose: () => void;
  onSaveRule: (rule: RuleDraft, id?: string) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rules = sortRules(ledger.rules ?? []);
  const tagSuggestions = collectLedgerTags(ledger);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState("100");
  const [matchField, setMatchField] = useState<RuleMatchField>("either");
  const [matchType, setMatchType] = useState<RuleMatchType>("contains");
  const [pattern, setPattern] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [setCategoryId, setSetCategoryId] = useState("");
  const [addTags, setAddTags] = useState<string[]>([]);
  const [setPayee, setSetPayee] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function startEdit(rule?: TransactionRule) {
    setError("");
    if (!rule) {
      const d = emptyDraft();
      setEditingId("new");
      setName(d.name);
      setEnabled(d.enabled);
      setPriority(String(d.priority));
      setMatchField(d.match_field);
      setMatchType(d.match_type);
      setPattern(d.pattern);
      setMinAmount("");
      setMaxAmount("");
      setSetCategoryId("");
      setAddTags([]);
      setSetPayee("");
      return;
    }
    setEditingId(rule.id);
    setName(rule.name);
    setEnabled(rule.enabled);
    setPriority(String(rule.priority));
    setMatchField(rule.match_field);
    setMatchType(rule.match_type);
    setPattern(rule.pattern);
    setMinAmount(
      rule.min_amount != null && rule.min_amount > 0
        ? (rule.min_amount / 100).toFixed(2)
        : "",
    );
    setMaxAmount(
      rule.max_amount != null && rule.max_amount > 0
        ? (rule.max_amount / 100).toFixed(2)
        : "",
    );
    setSetCategoryId(rule.set_category_id ?? "");
    setAddTags(rule.add_tags ?? []);
    setSetPayee(rule.set_payee ?? "");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const parsedPriority = Number.parseInt(priority.trim(), 10);
      const draft: RuleDraft = {
        name: name.trim(),
        enabled,
        priority: Number.isFinite(parsedPriority) ? parsedPriority : 100,
        match_field: matchField,
        match_type: matchType,
        pattern: pattern.trim(),
        min_amount: minAmount.trim() ? minor(minAmount.trim()) : null,
        max_amount: maxAmount.trim() ? minor(maxAmount.trim()) : null,
        set_category_id: setCategoryId || null,
        add_tags: addTags,
        set_payee: setPayee.trim(),
      };
      validateRule(draft, ledger.categories);
      await onSaveRule(draft, editingId === "new" ? undefined : editingId!);
      setEditingId(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleToggle(rule: TransactionRule) {
    setError("");
    try {
      const { id, ...rest } = rule;
      await onSaveRule({ ...rest, enabled: !rule.enabled }, id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal rules-modal"
      aria-labelledby="rules-modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">AUTOMATION</span>
          <h2 id="rules-modal-title">Transaction rules</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      <p className="muted small">
        Rules run deterministically in priority order (lowest number first) on
        imports and when you click Apply Rules in the editor.
      </p>

      {editingId ? (
        <form className="rules-form" onSubmit={handleSave}>
          <div className="form-row">
            <label>
              Rule name
              <input
                required
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Carrefour groceries"
              />
            </label>
            <label>
              Priority
              <input
                type="number"
                min={0}
                max={10000}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              Match field
              <select
                value={matchField}
                onChange={(e) =>
                  setMatchField(e.target.value as RuleMatchField)
                }
              >
                <option value="either">Payee or notes</option>
                <option value="payee">Payee only</option>
                <option value="notes">Notes only</option>
              </select>
            </label>
            <label>
              Match type
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as RuleMatchType)}
              >
                <option value="contains">Contains</option>
                <option value="starts_with">Starts with</option>
                <option value="exact">Exact match</option>
                <option value="regex">Regex (case-insensitive)</option>
              </select>
            </label>
          </div>

          <label>
            Pattern
            <input
              required
              maxLength={200}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={
                matchType === "regex"
                  ? "e.g. ^carrefour|spinneys"
                  : "e.g. carrefour"
              }
            />
          </label>

          <div className="form-row">
            <label>
              Min amount (AED) <span className="muted">Optional</span>
              <input
                inputMode="decimal"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label>
              Max amount (AED) <span className="muted">Optional</span>
              <input
                inputMode="decimal"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="No limit"
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              Set category <span className="muted">Optional</span>
              <select
                value={setCategoryId}
                onChange={(e) => setSetCategoryId(e.target.value)}
              >
                <option value="">Don't change</option>
                {ledger.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Set payee <span className="muted">Optional</span>
              <input
                maxLength={160}
                value={setPayee}
                onChange={(e) => setSetPayee(e.target.value)}
                placeholder="Clean merchant name"
              />
            </label>
          </div>

          <div className="field-block">
            <span className="field-label">
              Add tags <span className="muted">Optional</span>
            </span>
            <TagInput
              tags={addTags}
              onChange={setAddTags}
              suggestions={tagSuggestions}
              disabled={busy}
            />
          </div>

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Rule enabled
          </label>

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEditingId(null);
                setError("");
              }}
            >
              Back
            </button>
            <button type="submit" className="primary" disabled={busy}>
              <Check size={15} /> {editingId === "new" ? "Create rule" : "Save rule"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="rules-toolbar">
            <span className="muted small">
              {rules.length} {rules.length === 1 ? "rule" : "rules"}
            </span>
            <button
              type="button"
              className="primary compact-btn"
              disabled={busy}
              onClick={() => startEdit()}
            >
              <Plus size={14} /> New rule
            </button>
          </div>

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          {rules.length === 0 ? (
            <div className="notice">
              <Wand2 size={16} /> No rules yet. Create one to auto-categorize
              and tag transactions.
            </div>
          ) : (
            <ul className="rules-list">
              {rules.map((r) => {
                const cat = ledger.categories.find(
                  (c) => c.id === r.set_category_id,
                );
                return (
                  <li
                    key={r.id}
                    className={`rule-row ${r.enabled ? "" : "is-disabled"}`}
                  >
                    <div className="rule-main">
                      <div className="rule-title">
                        <b>{r.name}</b>
                        <span className="rule-badge">P{r.priority}</span>
                        {!r.enabled && (
                          <span className="rule-badge muted">Paused</span>
                        )}
                      </div>
                      <small className="muted">
                        {r.match_field} {r.match_type.replace("_", " ")} "
                        {r.pattern}"
                        {r.min_amount ? ` · min ${money(r.min_amount)}` : ""}
                        {r.max_amount ? ` · max ${money(r.max_amount)}` : ""}
                      </small>
                      <div className="rule-actions-summary">
                        {cat && (
                          <span className="tag-badge">→ {cat.name}</span>
                        )}
                        {r.set_payee && (
                          <span className="tag-badge">Payee: {r.set_payee}</span>
                        )}
                        {(r.add_tags ?? []).map((t) => (
                          <span className="tag-badge" key={t}>
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="rule-btns">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        title={r.enabled ? "Pause rule" : "Enable rule"}
                        aria-label={r.enabled ? `Pause ${r.name}` : `Enable ${r.name}`}
                        onClick={() => void handleToggle(r)}
                      >
                        <Power size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Edit ${r.name}`}
                        onClick={() => startEdit(r)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button delete"
                        disabled={busy}
                        aria-label={`Delete ${r.name}`}
                        onClick={() => void onDeleteRule(r.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="modal-actions">
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
