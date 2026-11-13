import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { plural, type Ledger } from "./domain";
import type { EditorModalState } from "./EditorModal";
import { Empty } from "./TransactionList";

export function CategoriesPage({
  ledger,
  density,
  busy,
  categoryCounts,
  selectedCategories,
  setSelectedCategories,
  toggleCategory,
  onDeleteCategories,
  onOpenModal,
}: {
  ledger: Ledger;
  density: "compact" | "relaxed";
  busy: boolean;
  categoryCounts: Map<string, number>;
  selectedCategories: Set<string>;
  setSelectedCategories: (next: Set<string>) => void;
  toggleCategory: (id: string) => void;
  onDeleteCategories: (ids: string[]) => void;
  onOpenModal: (modal: EditorModalState) => void;
}) {
  return (
    <>
      {ledger.categories.length > 0 && (
        <div className="panel bulk-toolbar category-toolbar">
          <label className="selection-label">
            <input
              type="checkbox"
              disabled={busy}
              checked={
                selectedCategories.size > 0 &&
                ledger.categories.every((c) => selectedCategories.has(c.id))
              }
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    selectedCategories.size > 0 &&
                    !ledger.categories.every((c) =>
                      selectedCategories.has(c.id),
                    );
              }}
              onChange={(e) =>
                setSelectedCategories(
                  e.target.checked
                    ? new Set(ledger.categories.map((c) => c.id))
                    : new Set(),
                )
              }
            />
            Select all
          </label>
          <span className="muted small">{selectedCategories.size} selected</span>
          <button
            className="secondary danger-outline"
            disabled={busy || !selectedCategories.size}
            onClick={() =>
              onDeleteCategories(
                ledger.categories
                  .filter((c) => selectedCategories.has(c.id))
                  .map((c) => c.id),
              )
            }
          >
            <Trash2 size={15} /> Delete selected
          </button>
          {selectedCategories.size > 0 && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setSelectedCategories(new Set())}
            >
              Clear selection
            </button>
          )}
        </div>
      )}
      {density === "compact" ? (
        <section className="panel compact-list">
          <div className="compact-head categories" aria-hidden>
            <span>Category</span>
            <span>Description</span>
            <span className="num">Transactions</span>
            <span />
          </div>
          {ledger.categories.map((c) => (
            <div
              className={`compact-row categories ${selectedCategories.has(c.id) ? "is-selected" : ""}`}
              key={c.id}
            >
              <span className="compact-name">
                <input
                  type="checkbox"
                  className="transaction-select category-select"
                  aria-label={`Select ${c.name}`}
                  disabled={busy}
                  checked={selectedCategories.has(c.id)}
                  onChange={() => toggleCategory(c.id)}
                />
                <span
                  className="compact-symbol"
                  style={{ color: c.color, background: c.color + "18" }}
                >
                  {c.emoji || <Tags size={15} />}
                </span>
                <b>{c.name}</b>
              </span>
              <span className="muted compact-text" title={c.description}>
                {c.description || "—"}
              </span>
              <span className="num muted">
                {categoryCounts.get(c.id) ?? 0}
              </span>
              <span className="compact-actions">
                <button
                  className="icon-button"
                  aria-label={`Edit ${c.name}`}
                  onClick={() => onOpenModal({ kind: "category", item: c })}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={`Delete ${c.name}`}
                  onClick={() => onDeleteCategories([c.id])}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
          {!ledger.categories.length && (
            <Empty
              title="Make it your own"
              text="Create categories that fit your life."
            />
          )}
        </section>
      ) : (
        <div className="account-grid full category-cards">
          {ledger.categories.map((c) => (
            <article
              className={`account-card ${selectedCategories.has(c.id) ? "is-selected" : ""}`}
              key={c.id}
            >
              <div className="account-top">
                <input
                  type="checkbox"
                  className="transaction-select category-select"
                  aria-label={`Select ${c.name}`}
                  disabled={busy}
                  checked={selectedCategories.has(c.id)}
                  onChange={() => toggleCategory(c.id)}
                />
                <span
                  className="account-symbol"
                  style={{ background: c.color + "18", color: c.color }}
                >
                  {c.emoji || <Tags size={20} />}
                </span>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => onOpenModal({ kind: "category", item: c })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={`Delete ${c.name}`}
                    onClick={() => onDeleteCategories([c.id])}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <h3>{c.name}</h3>
              <p className="muted small category-card-text">
                {c.description || "No description"}
              </p>
              <span className="account-kind">
                {plural(categoryCounts.get(c.id) ?? 0, "transaction")}
              </span>
            </article>
          ))}
          <button
            className="add-account-card"
            onClick={() => onOpenModal({ kind: "category" })}
          >
            <span>
              <Plus size={22} />
            </span>
            <b>Add a category</b>
            <small>Groceries, rent, salary, anything</small>
          </button>
        </div>
      )}
    </>
  );
}
