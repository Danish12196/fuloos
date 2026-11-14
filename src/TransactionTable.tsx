import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Paperclip,
  Pencil,
  ReceiptText,
  Search,
  Trash2,
} from "lucide-react";
import { DEFAULT_CURRENCY, formatOriginalCurrencyPill } from "./currency";
import { today, type Ledger, type Transaction } from "./domain";
import { collectLedgerTags } from "./enrichment";
import { downloadBlob, transactionsToCsv } from "./export";
import {
  buildRegister,
  entryCategory,
  entryNotes,
  entryPayee,
  filterRegister,
  groupByDay,
  sortRegister,
  type RegisterEntry,
  type SortDir,
  type SortKey,
} from "./register";
import { useDensity } from "./density";
import "./transactionTable.css";

const DEFAULT_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [50, 100, 250] as const;
const amountFormat = new Intl.NumberFormat("en-AE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const sortLabels: Record<SortKey, string> = {
  date: "Date",
  account: "Account",
  payee: "Payee",
  notes: "Notes",
  category: "Category",
  payment: "Payment",
  deposit: "Deposit",
  balance: "Balance",
};
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
function dayLabel(date: string) {
  return dayFormat.format(new Date(date + "T00:00:00Z"));
}

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
  onImportPdf,
  pendingAlertCount = 0,
  onOpenCaptureAlerts,
  onEditSelected,
  onDeleteSelected,
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
  onImportPdf: () => void;
  pendingAlertCount?: number;
  onOpenCaptureAlerts?: () => void;
  onEditSelected: (items: Transaction[]) => void;
  onDeleteSelected: (items: Transaction[]) => void;
  onEdit: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  onCategorize: (t: Transaction, categoryId: string) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "date",
    dir: "desc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [categorizing, setCategorizing] = useState<string | null>(null);
  const [density] = useDensity();

  useEffect(() => {
    setPage(1);
  }, [
    from,
    to,
    search,
    accountFilter,
    kindFilter,
    categoryFilter,
    tagFilter,
    sort.key,
    sort.dir,
    pageSize,
  ]);

  const ledgerTags = useMemo(() => collectLedgerTags(ledger), [ledger]);
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
          tag: tagFilter,
        }),
        ledger,
        sort.key,
        sort.dir,
      ),
    [register, ledger, from, to, search, kindFilter, categoryFilter, tagFilter, sort],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const shown = useMemo(
    () => rows.slice(startIdx, startIdx + pageSize),
    [rows, startIdx, pageSize],
  );
  const visibleIds = useMemo(
    () => [...new Set(rows.map((r) => r.tx.id))],
    [rows],
  );
  const pageIds = useMemo(
    () => [...new Set(shown.map((r) => r.tx.id))],
    [shown],
  );
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
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
    if (e.tx.splits && e.tx.splits.length > 0) {
      return (
        <span className="tx-category split-badge" title={entryCategory(e, ledger)}>
          Split ({e.tx.splits.length})
        </span>
      );
    }
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

  const endIdx = Math.min(startIdx + pageSize, rows.length);
  const more = rows.length > 0 && (
    <div className="tx-more tx-pagination">
      <span className="muted small">
        Showing {startIdx + 1}–{endIdx} of {rows.length}
      </span>
      <label className="tx-page-size">
        <span className="muted small">Rows</span>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
      {totalPages > 1 && (
        <div className="tx-page-nav">
          <button
            type="button"
            className="secondary"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={15} /> Prev
          </button>
          <span className="muted small">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            className="secondary"
            aria-label="Next page"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
  const signed = (v: number) =>
    hidden ? "••••" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;
  const card = (e: RegisterEntry) => {
    const t = e.tx;
    const label = t.payee || t.notes || "transaction";
    const notes = entryNotes(e);
    const isSelected = selected.has(t.id);
    const category = e.direction
      ? undefined
      : ledger.categories.find((c) => c.id === t.category_id);
    const accountName = ledger.accounts.find((a) => a.id === e.accountId)?.name;
    const amount = e.deposit - e.payment;
    const Icon = e.direction
      ? ArrowLeftRight
      : t.type === "income"
        ? ArrowDownLeft
        : ReceiptText;
    return (
      <li
        key={e.key}
        className={`tx-card ${isSelected ? "is-selected" : ""} ${e.direction ? "is-transfer" : ""}`}
        onClick={() => !busy && onEdit(t)}
      >
        <span className="tx-card-check" onClick={(ev) => ev.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${label} on ${t.date}`}
            disabled={busy}
            checked={isSelected}
            onChange={() => toggleOne(t.id)}
          />
        </span>
        <span
          className={`tx-card-icon ${e.direction ? "transfer" : t.type}`}
          style={
            category
              ? { background: category.color + "18", color: category.color }
              : undefined
          }
          aria-hidden
        >
          {category?.emoji || <Icon size={19} />}
        </span>
        <span className="tx-card-main">
          <b title={entryPayee(e, ledger)}>{entryPayee(e, ledger)}</b>
          <span className="tx-card-meta">
            {categoryCell(e)}
            {showAccount && accountName && (
              <span className="tx-card-account">{accountName}</span>
            )}
            {sort.key !== "date" && (
              <span className="tx-card-date">
                {t.date.slice(8, 10)}/{t.date.slice(5, 7)}/{t.date.slice(0, 4)}
              </span>
            )}
          </span>
          {notes && (
            <small className="tx-card-notes" title={notes}>
              {notes}
            </small>
          )}
          {((t.tags && t.tags.length > 0) || t.receipt) && (
            <span className="tx-tags-row">
              {(t.tags ?? []).map((tag) => (
                <span className="tag-badge" key={tag}>
                  #{tag}
                </span>
              ))}
              {t.receipt && (
                <span className="tag-badge receipt-badge" title="Receipt attached">
                  <Paperclip size={11} /> Receipt
                </span>
              )}
            </span>
          )}
        </span>
        <span className="tx-card-value">
          <b className={amount > 0 ? "is-in" : ""}>{signed(amount)}</b>
          {t.original_currency &&
            t.original_currency !== DEFAULT_CURRENCY &&
            t.original_amount !== undefined && (
              <span className="tag-badge fx-pill">
                {hidden
                  ? `${t.original_currency} ••••`
                  : formatOriginalCurrencyPill(
                      t.original_amount,
                      t.original_currency,
                      t.fx_rate,
                    )}
              </span>
            )}
          <small className={e.balance < 0 ? "is-negative" : ""}>
            {account ? "Balance" : "Total"} {fmt(e.balance)}
          </small>
        </span>
        <span
          className="tx-card-actions"
          onClick={(ev) => ev.stopPropagation()}
        >
          <button
            className="icon-button"
            disabled={busy}
            aria-label={`Edit ${label}`}
            onClick={() => onEdit(t)}
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button delete"
            disabled={busy}
            aria-label={`Delete ${label}`}
            onClick={() => onDelete(t)}
          >
            <Trash2 size={15} />
          </button>
        </span>
      </li>
    );
  };
  const relaxedView = (
    <div className="tx-relaxed">
      <div className="tx-relaxed-sort">
        <label>
          <span className="muted small">Sort by</span>
          <select
            aria-label="Sort transactions by"
            value={sort.key}
            onChange={(ev) => toggleSort(ev.target.value as SortKey)}
          >
            {(Object.keys(sortLabels) as SortKey[])
              .filter((k) => k !== "account" || showAccount)
              .map((k) => (
                <option key={k} value={k}>
                  {k === "balance" && !account
                    ? "Total balance"
                    : sortLabels[k]}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-button"
          aria-label={
            sort.dir === "asc" ? "Sorted ascending" : "Sorted descending"
          }
          title={sort.dir === "asc" ? "Ascending" : "Descending"}
          onClick={() => toggleSort(sort.key)}
        >
          {sort.dir === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        </button>
      </div>
      {sort.key === "date" ? (
        groupByDay(shown).map((g) => (
          <section className="tx-day" key={g.date + g.entries[0].key}>
            <header className="tx-day-head">
              <h3>{dayLabel(g.date)}</h3>
              <span className={g.net > 0 ? "is-in" : ""}>{signed(g.net)}</span>
            </header>
            <ul className="tx-cards">{g.entries.map(card)}</ul>
          </section>
        ))
      ) : (
        <ul className="tx-cards tx-cards-flat">{shown.map(card)}</ul>
      )}
      {more}
    </div>
  );

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
        {onOpenCaptureAlerts && (
          <button
            type="button"
            className="secondary"
            disabled={busy || loading}
            onClick={onOpenCaptureAlerts}
          >
            Captured alerts{pendingAlertCount > 0 ? ` (${pendingAlertCount})` : ""}
          </button>
        )}
        <button
          className="secondary"
          disabled={busy || loading || !ledger.accounts.length}
          onClick={onImportPdf}
        >
          Import PDF
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || loading || !visibleIds.length}
          onClick={() => {
            const seen = new Set<string>();
            const filtered = rows.flatMap((r) => {
              if (seen.has(r.tx.id)) return [];
              seen.add(r.tx.id);
              return [r.tx];
            });
            downloadBlob(
              transactionsToCsv(filtered, ledger),
              `fuloos-transactions-${today()}.csv`,
              "text/csv;charset=utf-8",
            );
          }}
        >
          Export CSV
        </button>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search transactions"
            placeholder="Search payee, notes, category, amount…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter account"
          value={accountFilter}
          onChange={(e) => onAccountFilter(e.target.value)}
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
          onChange={(e) => onKindFilter(e.target.value)}
        >
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
        <select
          aria-label="Filter category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {ledger.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {ledgerTags.length > 0 && (
          <select
            aria-label="Filter tag"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="">All tags</option>
            {ledgerTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
        )}
        <span className="muted small">
          {visibleIds.length} transaction{visibleIds.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="bulk-toolbar">
        <label className="selection-label">
          <input
            type="checkbox"
            disabled={busy || loading || !pageIds.length}
            checked={
              pageIds.length > 0 && selectedOnPage === pageIds.length
            }
            onChange={(e) => {
              const next = new Set(selected);
              for (const id of pageIds) {
                if (e.target.checked) next.add(id);
                else next.delete(id);
              }
              onSelectionChange(next);
            }}
          />
          {totalPages > 1
            ? `Select all ${pageIds.length} on page`
            : `Select all ${pageIds.length} results`}
        </label>
        <span>
          {selected.size} selected · {selectedOnPage} on this page
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
          className="secondary danger-outline"
          disabled={busy || loading || !selected.size}
          onClick={() =>
            onDeleteSelected(
              ledger.transactions.filter((t) => selected.has(t.id)),
            )
          }
        >
          <Trash2 size={15} /> Delete selected
        </button>
        <button
          className="text-button"
          disabled={busy || !selected.size}
          onClick={() => onSelectionChange(new Set())}
        >
          Clear selection
        </button>
      </div>
      {rows.length && density === "relaxed" ? (
        relaxedView
      ) : rows.length ? (
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
              {shown.map((e) => {
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
                      <span>{entryPayee(e, ledger)}</span>
                      {t.tags && t.tags.length > 0 && (
                        <span className="tx-tags-inline">
                          {t.tags.map((tag) => (
                            <span className="tag-badge" key={tag}>
                              #{tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="tx-text tx-notes" title={notes}>
                      {notes}
                    </td>
                    <td className="tx-text" title={entryCategory(e, ledger)}>
                      {categoryCell(e)}
                    </td>
                    <td className="num">
                      {e.payment ? (
                        <>
                          <span>{fmt(e.payment)}</span>
                          {t.original_currency &&
                            t.original_currency !== DEFAULT_CURRENCY &&
                            t.original_amount !== undefined && (
                              <span
                                className="tag-badge fx-pill"
                                style={{ marginLeft: 6 }}
                              >
                                {hidden
                                  ? `${t.original_currency} ••••`
                                  : formatOriginalCurrencyPill(
                                      t.original_amount,
                                      t.original_currency,
                                      t.fx_rate,
                                    )}
                              </span>
                            )}
                        </>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="num tx-deposit">
                      {e.deposit ? (
                        <>
                          <span>{fmt(e.deposit)}</span>
                          {t.original_currency &&
                            t.original_currency !== DEFAULT_CURRENCY &&
                            t.original_amount !== undefined && (
                              <span
                                className="tag-badge fx-pill"
                                style={{ marginLeft: 6 }}
                              >
                                {hidden
                                  ? `${t.original_currency} ••••`
                                  : formatOriginalCurrencyPill(
                                      t.original_amount,
                                      t.original_currency,
                                      t.fx_rate,
                                    )}
                              </span>
                            )}
                        </>
                      ) : (
                        ""
                      )}
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
                      {t.receipt && (
                        <button
                          type="button"
                          className="icon-button"
                          disabled={busy}
                          title="View receipt"
                          aria-label={`View receipt for ${label}`}
                          onClick={() => onEdit(t)}
                        >
                          <Paperclip size={14} />
                        </button>
                      )}
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
          {more}
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
