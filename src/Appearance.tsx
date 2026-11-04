import { useState } from "react";

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
  return (
    <label>
      Emoji <span className="muted">Optional</span>
      <input
        name="emoji"
        maxLength={32}
        defaultValue={defaultValue}
        placeholder="e.g. 🏦, 🛒, ☕"
      />
    </label>
  );
}
