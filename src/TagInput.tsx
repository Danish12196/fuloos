import React, { useState } from "react";
import { X } from "lucide-react";
import {
  MAX_TAGS_PER_TX,
  MAX_TAG_LENGTH,
  normalizeTag,
  normalizeTags,
} from "./enrichment";

export function TagInput({
  tags,
  onChange,
  suggestions = [],
  placeholder = "Add tag and press Enter",
  disabled = false,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const datalistId = React.useId();

  function addRaw(raw: string) {
    const next = normalizeTags([...tags, ...raw.split(",")]);
    onChange(next);
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  const unusedSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="tag-input-wrap">
      {tags.length > 0 && (
        <div className="tag-chips" aria-label="Selected tags">
          {tags.map((tag) => (
            <span className="tag-chip" key={tag}>
              #{tag}
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`Remove tag ${tag}`}
                disabled={disabled}
                onClick={() => removeTag(tag)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-input-row">
        <input
          type="text"
          value={draft}
          disabled={disabled || tags.length >= MAX_TAGS_PER_TX}
          maxLength={MAX_TAG_LENGTH}
          list={unusedSuggestions.length ? datalistId : undefined}
          placeholder={
            tags.length >= MAX_TAGS_PER_TX
              ? `Max ${MAX_TAGS_PER_TX} tags reached`
              : placeholder
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              if (draft.trim()) {
                e.preventDefault();
                addRaw(draft);
              }
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              removeTag(tags[tags.length - 1]);
            }
          }}
          onBlur={() => {
            if (normalizeTag(draft)) addRaw(draft);
          }}
        />
        {draft.trim() && (
          <button
            type="button"
            className="secondary compact-btn"
            disabled={disabled || tags.length >= MAX_TAGS_PER_TX}
            onClick={() => addRaw(draft)}
          >
            Add
          </button>
        )}
      </div>
      {unusedSuggestions.length > 0 && (
        <datalist id={datalistId}>
          {unusedSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
