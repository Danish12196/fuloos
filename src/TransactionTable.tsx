import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Pencil,
  ReceiptText,
  Search,
  Trash2,
} from "lucide-react";
import type { Ledger, Transaction } from "./domain";
import {
  buildRegister,
  entryCategory,
  entryNotes,
  entryPayee,
  filterRegister,
  sortRegister,
  type RegisterEntry,
  type SortDir,
  type SortKey,
} from "./register";
import "./transactionTable.css";

const PAGE = 200;
const amountFormat = new Intl.NumberFormat("en-AE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function TransactionsPanel({
  ledger,
  from,
  to,
  hidden,
  busy,
  loading,
  search,
  onSearch,
  accountFilter,
  onAccountFilter,
  kindFilter,
  onKindFilter,
  selected,
  onSelectionChange,
  onImport,
  onImportSms,
  onEditSelected,
  onEdit,
  onDelete,
  onCategorize,
}: {
  ledger: Ledger;
  from?: string;
  to?: string;
  hidden: boolean;
  busy: boolean;
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  accountFilter: string;
  onAccountFilter: (v: string) => void;
  kindFilter: string;
  onKindFilter: (v: string) => void;
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onImport: () => void;
  onImportSms: () => void;
  onEditSelected: (items: Transaction[]) => void;
  onEdit: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  onCategorize: (t: Transaction, categoryId: string) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "date",
    dir: "desc",
  });
  const [limit, setLimit] = useState(PAGE);
  const [categorizing, setCategorizing] = useState<string | null>(null);

  const account = ledger.accounts.find((a) => a.id === accountFilter);
  const register = useMemo(
    () => buildRegister(ledger, account?.id ?? ""),
    [ledger, account?.id],
  );
  const rows = useMemo(
    () =>
      sortRegister(
        filterRegister(register, ledger, {
          from,
          to,
          search,
          kind: kindFilter as "",
          category: categoryFilter,
        }),
        ledger,
        sort.key,
        sort.dir,
      ),
    [register, ledger, from, to, search, kindFilter, categoryFilter, sort],
  );
  const visibleIds = useMemo(
    () => [...new Set(rows.map((r) => r.tx.id))],
    [rows],
  );
  const selectedHere = visibleIds.filter((id) => selected.has(id)).length;
  const showAccount = !account;
  const fmt = (v: number) => (hidden ? "••••" : amountFormat.format(v / 100));

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : {
            key,
            dir:
              key === "date" ||
              key === "balance" ||
              key === "payment" ||
              key === "deposit"
                ? "desc"
                : "asc",
          },
    );
  }
  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }
  const header = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    const Icon = !active
      ? ChevronsUpDown
      : sort.dir === "asc"
        ? ArrowUp
        : ArrowDown;
    return (
      <th
        className={className}
        aria-sort={
          active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        <button
          type="button"
          className={`tx-sort ${active ? "is-active" : ""}`}
          onClick={() => toggleSort(key)}
        >
          {label}
          <Icon size={13} aria-hidden />
        </button>
      </th>
    );
  };
  const categoryCell = (e: RegisterEntry) => {
    if (e.direction) return <span className="tx-transfer">Transfer</span>;
    const category = ledger.categories.find((c) => c.id === e.tx.category_id);
    if (category)
      return (
        <span className="tx-category">
          <i style={{ background: category.color }} aria-hidden />
          {category.name}
        </span>
      );
    if (categorizing === e.key && ledger.categories.length)
      return (
        <select
          className="tx-categorize-select"
          autoFocus
          aria-label={`Category for ${e.tx.payee || e.tx.notes || "transaction"}`}
          defaultValue=""
          disabled={busy}
          onClick={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => {
            ev.stopPropagation();
            if (ev.key === "Escape") setCategorizing(null);
          }}
          onBlur={() => setCategorizing(null)}
          onChange={(ev) => {
            if (ev.target.value) onCategorize(e.tx, ev.target.value);
            setCategorizing(null);
          }}
        >
          <option value="" disabled>
            Choose a category…
          </option>
          {ledger.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
    return (
      <button
        type="button"
        className="tx-categorize"
        disabled={busy}
        onClick={(ev) => {
          ev.stopPropagation();
          if (ledger.categories.length) setCategorizing(e.key);
          else onEdit(e.tx);
        }}
      >
        Categorize
      </button>
    );
  };

  return (
    <section className="panel">
      <div className="filters">
        <button
          className="secondary"
          disabled={busy || loading || !ledger.accounts.length}
          onClick={onImport}
        >
          Import CSV
        </button>
        <button
          className="secondary"
          disabled={busy || loading || !ledger.accounts.length}
          onClick={onImportSms}
        >
          Import SMS
        </button>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search transactions"
            placeholder="Search payee, notes, category, amount…"
            value={search}
            onChange={(e) => {
              onSearch(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
        <select
          aria-label="Filter account"
          value={accountFilter}
          onChange={(e) => {
            onAccountFilter(e.target.value);
            setLimit(PAGE);
          }}
        >
          <option value="">All accounts</option>
          {ledger.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter type"
          value={kindFilter}
          onChange={(e) => {
            onKindFilter(e.target.value);
            setLimit(PAGE);
          }}
        >
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
        <select
          aria-label="Filter category"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setLimit(PAGE);
          }}
        >
          <option value="">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {ledger.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="muted small">
          {visibleIds.length} transaction{visibleIds.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="bulk-toolbar">
        <label className="selection-label">
          <input
            type="checkbox"
            disabled={busy || loading || !visibleIds.length}
            checked={
              visibleIds.length > 0 && selectedHere === visibleIds.length
            }
            onChange={(e) => {
              const next = new Set(selected);
              for (const id of visibleIds) {
                if (e.target.checked) next.add(id);
                else next.delete(id);
              }
              onSelectionChange(next);
            }}
          />
          Select all {visibleIds.length} results
        </label>
        <span>
          {selected.size} selected · {selectedHere} in these results
        </span>
        <button
          className="secondary"
          disabled={busy || loading || !selected.size}
          onClick={() =>
            onEditSelected(
              ledger.transactions.filter((t) => selected.has(t.id)),
            )
          }
        >
          Edit selected
        </button>
        <button
          className="text-button"
          disabled={busy || !selected.size}
          onClick={() => onSelectionChange(new Set())}
        >
          Clear selection
        </button>
      </div>
      {rows.length ? (
        <div className="tx-table-wrap">
          <table className={`tx-table ${showAccount ? "with-account" : ""}`}>
            <thead>
              <tr>
                <th className="tx-check">
                  <span className="sr-only">Select</span>
                </th>
                {header("date", "Date")}
                {showAccount && header("account", "Account")}
                {header("payee", "Payee")}
                {header("notes", "Notes")}
                {header("category", "Category")}
                {header("payment", "Payment", "num")}
                {header("deposit", "Deposit", "num")}
                {header(
                  "balance",
                  account ? "Balance" : "Total balance",
                  "num",
                )}
                <th className="tx-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((e) => {
                const t = e.tx;
                const label = t.payee || t.notes || "transaction";
                const notes = entryNotes(e);
                const isSelected = selected.has(t.id);
                return (
                  <tr
                    key={e.key}
                    className={`${isSelected ? "is-selected" : ""} ${e.direction ? "is-transfer" : ""}`}
                    onClick={() => !busy && onEdit(t)}
                  >
                    <td
                      className="tx-check"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${label} on ${t.date}`}
                        disabled={busy}
                        checked={isSelected}
                        onChange={() => toggleOne(t.id)}
                      />
                    </td>
                    <td className="tx-date">
                      {t.date.slice(8, 10)}/{t.date.slice(5, 7)}/
                      {t.date.slice(0, 4)}
                    </td>
                    {showAccount && (
                      <td className="tx-text tx-account">
                        {ledger.accounts.find((a) => a.id === e.accountId)
                          ?.name ?? ""}
                      </td>
                    )}
                    <td
                      className="tx-text tx-payee"
                      title={entryPayee(e, ledger)}
                    >
                      {entryPayee(e, ledger)}
                    </td>
                    <td className="tx-text tx-notes" title={notes}>
                      {notes}
                    </td>
                    <td className="tx-text" title={entryCategory(e, ledger)}>
                      {categoryCell(e)}
                    </td>
                    <td className="num">{e.payment ? fmt(e.payment) : ""}</td>
                    <td className="num tx-deposit">
                      {e.deposit ? fmt(e.deposit) : ""}
                    </td>
                    <td
                      className={`num tx-balance ${e.balance < 0 ? "is-negative" : ""}`}
                    >
                      {fmt(e.balance)}
                    </td>
                    <td
                      className="tx-actions"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Edit ${label}`}
                        onClick={() => onEdit(t)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button delete"
                        disabled={busy}
                        aria-label={`Delete ${label}`}
                        onClick={() => onDelete(t)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > limit && (
            <div className="tx-more">
              <span className="muted small">
                Showing {limit} of {rows.length} rows
              </span>
              <button
                className="secondary"
                onClick={() => setLimit((l) => l + PAGE)}
              >
                Show {Math.min(PAGE, rows.length - limit)} more
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="empty">
          <ReceiptText size={28} />
          <h3>Nothing here yet</h3>
          <p>Add a transaction, or try a different period, search or filter.</p>
        </div>
      )}
    </section>
  );
}
