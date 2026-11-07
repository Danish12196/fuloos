import { useMemo, useState } from "react";
import { Search, Smile } from "lucide-react";
import { emojiGroups, searchEmojis } from "./emojiData";

const palette = [
  "#1d5b48",
  "#b08448",
  "#696198",
  "#619a92",
  "#b86e69",
  "#768db1",
  "#e29338",
  "#c75683",
  "#397bbe",
  "#7b9845",
  "#9446a8",
  "#535f70",
];
export function ColorPicker({
  defaultValue = palette[0],
}: {
  defaultValue?: string;
}) {
  const [color, setColor] = useState(defaultValue);
  const [choices, setChoices] = useState(palette);
  return (
    <div className="appearance-picker">
      <span>Color</span>
      <input type="hidden" name="color" value={color} />
      <div className="color-swatches">
        {choices.map((c) => (
          <button
            type="button"
            key={c}
            aria-label={`Choose ${c}`}
            aria-pressed={color === c}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          setChoices(
            Array.from(
              { length: 12 },
              () =>
                `#${Math.floor(Math.random() * 16777216)
                  .toString(16)
                  .padStart(6, "0")}`,
            ),
          )
        }
      >
        Shuffle colors
      </button>
      <label className="custom-color">
        Full color picker{" "}
        <input
          aria-label="Custom color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
    </div>
  );
}
export function EmojiField({ defaultValue = "" }: { defaultValue?: string }) {
  const [emoji, setEmoji] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(emojiGroups[0].name);
  const searching = query.trim().length > 0;
  const shown = useMemo(
    () =>
      searching
        ? searchEmojis(query)
        : (
            emojiGroups.find((g) => g.name === group) ?? emojiGroups[0]
          ).items.map((i) => i.emoji),
    [query, group, searching],
  );
  const pick = (value: string) => {
    setEmoji(value);
    setOpen(false);
    setQuery("");
  };
  return (
    <div className="emoji-picker">
      <span className="emoji-label">
        Emoji <span className="muted">Optional</span>
      </span>
      <input type="hidden" name="emoji" value={emoji} />
      <div className="emoji-current">
        <button
          type="button"
          className="emoji-preview"
          aria-expanded={open}
          aria-label={emoji ? `Change emoji ${emoji}` : "Pick an emoji"}
          onClick={() => setOpen((o) => !o)}
        >
          {emoji || <Smile size={20} />}
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : emoji ? "Change" : "Pick an emoji"}
        </button>
        {emoji && (
          <button
            type="button"
            className="text-button"
            onClick={() => pick("")}
          >
            Remove
          </button>
        )}
      </div>
      {open && (
        <div className="emoji-panel">
          <div className="emoji-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              autoFocus
              aria-label="Search emojis"
              placeholder="Search, e.g. bank, food, car"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter picks the first result instead of submitting the form.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (shown[0]) pick(shown[0]);
                }
              }}
            />
          </div>
          {!searching && (
            <div
              className="emoji-tabs"
              role="tablist"
              aria-label="Emoji groups"
            >
              {emojiGroups.map((g) => (
                <button
                  type="button"
                  role="tab"
                  key={g.name}
                  title={g.name}
                  aria-label={g.name}
                  aria-selected={g.name === group}
                  onClick={() => setGroup(g.name)}
                >
                  {g.icon}
                </button>
              ))}
            </div>
          )}
          <p className="emoji-heading">
            {searching
              ? shown.length
                ? `Results for “${query.trim()}”`
                : `No emojis match “${query.trim()}”`
              : group}
          </p>
          <div className="emoji-grid">
            {shown.map((e) => (
              <button
                type="button"
                key={e}
                aria-label={`Use ${e}`}
                aria-pressed={e === emoji}
                onClick={() => pick(e)}
              >
                {e}
              </button>
            ))}
          </div>
          <label className="emoji-custom">
            Or type or paste any emoji
            <input
              maxLength={32}
              value={emoji}
              placeholder="e.g. 🏦"
              onChange={(e) => setEmoji(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
