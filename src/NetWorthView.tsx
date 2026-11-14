import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  History,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { confirmDialog } from "./dialogStore";
import {
  balance,
  errorMessage,
  minor,
  today,
  type Ledger,
} from "./domain";
import {
  NET_WORTH_ASSET_CATEGORIES,
  NET_WORTH_CATEGORIES,
  NET_WORTH_LIABILITY_CATEGORIES,
  buildNetWorthSeries,
  computeNetWorthSummary,
  validateNetWorthItem,
  validateNetWorthSnapshot,
  type NetWorthCategory,
  type NetWorthItem,
  type NetWorthKind,
  type NetWorthSnapshot,
} from "./netWorth";

export type NetWorthItemDraft = Omit<NetWorthItem, "id">;

const NW_COLORS = [
  "#1d5b48",
  "#b08448",
  "#619a92",
  "#696198",
  "#3f7d8b",
  "#b3543b",
  "#c06c4c",
];

function formatDateShort(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}

function formatMonthShort(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "Asia/Dubai",
  });
}

function NetWorthTrendChart({
  series,
  concealed,
}: {
  series: ReturnType<typeof buildNetWorthSeries>;
  concealed: (v: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 760;
  const height = 210;
  const padLeft = 18;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = series.map((p) => p.netWorth);
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(100, ...values);
  const span = Math.max(1, maxVal - minVal);

  const coords = series.map((p, idx) => {
    const x =
      series.length === 1
        ? padLeft + plotW / 2
        : padLeft + (idx / (series.length - 1)) * plotW;
    const y = padTop + (1 - (p.netWorth - minVal) / span) * plotH;
    return { x, y, point: p };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : "";

  const zeroY = padTop + (1 - (0 - minVal) / span) * plotH;
  const active =
    hoverIdx !== null && coords[hoverIdx]
      ? coords[hoverIdx]
      : coords[coords.length - 1];

  const labelStep = series.length > 14 ? 3 : series.length > 8 ? 2 : 1;

  return (
    <div className="nw-chart-panel">
      {active && (
        <div className="nw-chart-legend">
          <span className="nw-chart-legend-item">
            <span
              className="nw-legend-swatch"
              style={{ background: "#1d5b48" }}
            />
            <strong>{formatMonthShort(active.point.month)}:</strong>{" "}
            {concealed(active.point.netWorth)}
          </span>
          <span className="nw-chart-legend-item">
            Assets: <b>{concealed(active.point.totalAssets)}</b>
          </span>
          <span className="nw-chart-legend-item">
            Liabilities: <b>{concealed(active.point.totalLiabilities)}</b>
          </span>
        </div>
      )}
      <div className="nw-svg-wrap">
        <svg
          className="nw-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Net worth trend over time"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="nwAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1d5b48" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#1d5b48" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((frac) => {
            const y = padTop + frac * plotH;
            return (
              <line
                key={frac}
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                className="nw-chart-grid-line"
              />
            );
          })}
          {minVal < 0 && maxVal > 0 && (
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={zeroY}
              y2={zeroY}
              stroke="#b5524a"
              strokeDasharray="4 4"
              strokeOpacity="0.5"
            />
          )}
          {areaPath && <path d={areaPath} fill="url(#nwAreaGrad)" />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#1d5b48"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {coords.map((c, idx) => {
            const isSelected = active?.point.month === c.point.month;
            return (
              <g
                key={c.point.month}
                onMouseEnter={() => setHoverIdx(idx)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={isSelected ? 5.5 : 3.5}
                  fill={isSelected ? "#1d5b48" : "var(--surface, #fff)"}
                  stroke="#1d5b48"
                  strokeWidth="2"
                />
                {(idx % labelStep === 0 || idx === coords.length - 1) && (
                  <text
                    x={c.x}
                    y={height - 8}
                    textAnchor="middle"
                    className="nw-chart-axis-text"
                  >
                    {formatMonthShort(c.point.month)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function NetWorthPage({
  ledger,
  concealed,
  busy,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onUpdateValuation,
  onDeleteSnapshot,
  onNavigateAccounts,
}: {
  ledger: Ledger;
  concealed: (v: number) => string;
  busy: boolean;
  onAddItem: () => void;
  onEditItem: (item: NetWorthItem) => void;
  onDeleteItem: (item: NetWorthItem) => void;
  onUpdateValuation: (item: NetWorthItem) => void;
  onDeleteSnapshot: (snapshot: NetWorthSnapshot) => void;
  onNavigateAccounts: () => void;
}) {
  const [months, setMonths] = useState<6 | 12 | 24>(12);
  const [kindFilter, setKindFilter] = useState<"all" | NetWorthKind>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const items = ledger.net_worth_items ?? [];
  const snapshots = ledger.net_worth_snapshots ?? [];
  const todayIso = today();

  const summary = useMemo(
    () =>
      computeNetWorthSummary(
        ledger.accounts,
        ledger.transactions,
        items,
        todayIso,
      ),
    [ledger.accounts, ledger.transactions, items, todayIso],
  );

  const series = useMemo(
    () =>
      buildNetWorthSeries(
        ledger.accounts,
        ledger.transactions,
        items,
        snapshots,
        months,
        todayIso,
      ),
    [ledger.accounts, ledger.transactions, items, snapshots, months, todayIso],
  );

  const filteredItems = useMemo(() => {
    const list =
      kindFilter === "all"
        ? items
        : items.filter((i) => i.kind === kindFilter);
    return list.slice().sort((a, b) => b.current_value - a.current_value);
  }, [items, kindFilter]);

  const snapshotsByItem = useMemo(() => {
    const map = new Map<string, NetWorthSnapshot[]>();
    for (const s of snapshots) {
      const list = map.get(s.item_id) ?? [];
      list.push(s);
      map.set(s.item_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.date.localeCompare(a.date));
    }
    return map;
  }, [snapshots]);

  return (
    <div className="nw-page">
      <section className="stats nw-stats">
        <article className="stat net">
          <div className="stat-label">
            Net Worth
            <span className="round-icon green">
              <TrendingUp size={18} />
            </span>
          </div>
          <h2>{concealed(summary.netWorth)}</h2>
          <small>
            Assets minus liabilities{" "}
            <span>
              {ledger.accounts.length} accounts · {items.length} tracked items
            </span>
          </small>
          <div className="stat-decoration" />
        </article>
        <article className="stat">
          <div className="stat-label">
            Total Assets
            <span className="round-icon green">
              <ArrowDownLeft size={18} />
            </span>
          </div>
          <h2>{concealed(summary.totalAssets)}</h2>
          <small>
            Cash {concealed(summary.cashAssets)} · Tracked{" "}
            {concealed(summary.trackedAssets)}
          </small>
        </article>
        <article className="stat">
          <div className="stat-label">
            Total Liabilities
            <span className="round-icon terracotta">
              <ArrowUpRight size={18} />
            </span>
          </div>
          <h2>{concealed(summary.totalLiabilities)}</h2>
          <small>
            Cards {concealed(summary.accountLiabilities)} · Loans{" "}
            {concealed(summary.trackedLiabilities)}
          </small>
        </article>
      </section>

      <section className="panel">
        <div className="nw-chart-head">
          <div>
            <h2>Net Worth trend</h2>
            <p className="muted">
              Monthly snapshot combining account balances and valuation history
            </p>
          </div>
          <div className="nw-range-pills" role="group" aria-label="Trend range">
            {([6, 12, 24] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={months === m ? "active" : ""}
                onClick={() => setMonths(m)}
              >
                {m}M
              </button>
            ))}
          </div>
        </div>
        <NetWorthTrendChart series={series} concealed={concealed} />
      </section>

      <div className="nw-toolbar">
        <div className="nw-filter-pills" role="group" aria-label="Filter items">
          <button
            type="button"
            className={kindFilter === "all" ? "active" : ""}
            onClick={() => setKindFilter("all")}
          >
            All ({items.length})
          </button>
          <button
            type="button"
            className={kindFilter === "asset" ? "active" : ""}
            onClick={() => setKindFilter("asset")}
          >
            Assets ({items.filter((i) => i.kind === "asset").length})
          </button>
          <button
            type="button"
            className={kindFilter === "liability" ? "active" : ""}
            onClick={() => setKindFilter("liability")}
          >
            Liabilities ({items.filter((i) => i.kind === "liability").length})
          </button>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={onAddItem}
        >
          <Plus size={16} /> Add asset or liability
        </button>
      </div>

      {filteredItems.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <Landmark size={26} />
            <h3>No tracked assets or liabilities yet</h3>
            <p>
              Add investments, gold, property, crypto, or loans to track your
              full Net Worth beyond everyday cash accounts.
            </p>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={onAddItem}
            >
              <Plus size={16} /> Add asset or liability
            </button>
          </div>
        </section>
      ) : (
        <section className="nw-grid">
          {filteredItems.map((item) => {
            const cat = NET_WORTH_CATEGORIES[item.category];
            const history = snapshotsByItem.get(item.id) ?? [];
            const isExpanded = expandedId === item.id;
            return (
              <article key={item.id} className="panel nw-card">
                <div className="nw-card-head">
                  <div className="nw-title-wrap">
                    <span
                      className="nw-symbol"
                      style={{
                        background: `${item.color}1a`,
                        color: item.color,
                      }}
                    >
                      {item.emoji || cat?.emoji || "💎"}
                    </span>
                    <div>
                      <div className="nw-badges">
                        <span className={`nw-kind-pill ${item.kind}`}>
                          {item.kind === "asset" ? "Asset" : "Liability"}
                        </span>
                        <span className="nw-kind-pill">
                          {cat?.label ?? item.category}
                        </span>
                      </div>
                      <h3>{item.name}</h3>
                    </div>
                  </div>
                  <div className="nw-card-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${item.name}`}
                      disabled={busy}
                      onClick={() => onEditItem(item)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${item.name}`}
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: `Delete "${item.name}"?`,
                          message:
                            "This removes the item and all of its valuation snapshots.",
                          confirmLabel: "Delete",
                          tone: "danger",
                        });
                        if (ok) onDeleteItem(item);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="nw-value-row">
                  <span className={`nw-value ${item.kind}`}>
                    {item.kind === "liability" ? "-" : ""}
                    {concealed(item.current_value)}
                  </span>
                  <small className="muted">
                    As of {formatDateShort(item.as_of_date)}
                  </small>
                </div>

                {item.notes && <p className="muted">{item.notes}</p>}

                <div className="nw-card-footer">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => onUpdateValuation(item)}
                  >
                    <RefreshCw size={14} /> Update valuation
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : item.id)
                    }
                  >
                    <History size={14} />
                    {history.length} snapshot{history.length === 1 ? "" : "s"}
                  </button>
                </div>

                {isExpanded && (
                  <div className="nw-history-list">
                    {history.length === 0 ? (
                      <small className="muted">No valuation snapshots yet.</small>
                    ) : (
                      history.map((snap) => (
                        <div key={snap.id} className="nw-history-row">
                          <div>
                            <strong>{formatDateShort(snap.date)}</strong>
                            {snap.notes && (
                              <span className="muted"> · {snap.notes}</span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span>{concealed(snap.value)}</span>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Delete snapshot"
                              disabled={busy}
                              onClick={() => onDeleteSnapshot(snap)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {ledger.accounts.length > 0 && (
        <section className="panel nw-accounts-strip">
          <div className="panel-heading">
            <div>
              <h2>Included cash &amp; credit accounts</h2>
              <p className="muted">
                Automatically included in your Net Worth total
              </p>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={onNavigateAccounts}
            >
              Manage accounts <ArrowRight size={15} />
            </button>
          </div>
          <div className="nw-accounts-list">
            {ledger.accounts.map((acc) => {
              const bal = balance(acc, ledger.transactions);
              return (
                <div key={acc.id} className="nw-account-chip">
                  <span>
                    {acc.emoji ? `${acc.emoji} ` : ""}
                    {acc.name}
                  </span>
                  <strong style={{ color: bal < 0 ? "#b5524a" : undefined }}>
                    {concealed(bal)}
                  </strong>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function DashboardNetWorth({
  ledger,
  concealed,
  onOpenNetWorth,
}: {
  ledger: Ledger;
  concealed: (v: number) => string;
  onOpenNetWorth: () => void;
}) {
  const items = ledger.net_worth_items ?? [];
  const summary = useMemo(
    () =>
      computeNetWorthSummary(
        ledger.accounts,
        ledger.transactions,
        items,
        today(),
      ),
    [ledger.accounts, ledger.transactions, items],
  );

  return (
    <section className="panel nw-overview-card">
      <div>
        <div className="eyebrow">NET WORTH SNAPSHOT</div>
        <h3>{concealed(summary.netWorth)}</h3>
        <small className="muted">
          Includes {ledger.accounts.length} accounts &amp; {items.length}{" "}
          tracked assets/liabilities
        </small>
      </div>
      <div className="nw-overview-metrics">
        <div className="nw-overview-metric">
          <small>Total Assets</small>
          <strong>{concealed(summary.totalAssets)}</strong>
        </div>
        <div className="nw-overview-metric">
          <small>Total Liabilities</small>
          <strong>{concealed(summary.totalLiabilities)}</strong>
        </div>
        <button
          type="button"
          className="text-button"
          onClick={onOpenNetWorth}
        >
          Open Net Worth <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}

export function NetWorthItemEditorModal({
  item,
  busy,
  onClose,
  onSave,
}: {
  item?: NetWorthItem;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: NetWorthItemDraft, id?: string) => Promise<void>;
}) {
  const initialKind: NetWorthKind = item?.kind ?? "asset";
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState<NetWorthKind>(initialKind);
  const [category, setCategory] = useState<NetWorthCategory>(
    item?.category ?? "investment",
  );
  const [valueInput, setValueInput] = useState(
    item ? (item.current_value / 100).toFixed(2) : "",
  );
  const [asOfDate, setAsOfDate] = useState(item?.as_of_date ?? today());
  const [color, setColor] = useState(item?.color ?? NW_COLORS[0]);
  const [emoji, setEmoji] = useState(item?.emoji ?? "📈");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [err, setErr] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const availableCategories =
    kind === "asset"
      ? NET_WORTH_ASSET_CATEGORIES
      : NET_WORTH_LIABILITY_CATEGORIES;

  function handleKindChange(nextKind: NetWorthKind) {
    setKind(nextKind);
    const defaultCat: NetWorthCategory =
      nextKind === "asset" ? "investment" : "mortgage";
    setCategory(defaultCat);
    if (!item) {
      setColor(NET_WORTH_CATEGORIES[defaultCat].color);
      setEmoji(NET_WORTH_CATEGORIES[defaultCat].emoji);
    }
  }

  function handleCategoryChange(nextCat: NetWorthCategory) {
    setCategory(nextCat);
    if (!item) {
      setColor(NET_WORTH_CATEGORIES[nextCat].color);
      setEmoji(NET_WORTH_CATEGORIES[nextCat].emoji);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const val = minor(valueInput || "0");
      const draft: NetWorthItemDraft = {
        name: name.trim(),
        kind,
        category,
        current_value: val,
        as_of_date: asOfDate,
        notes: notes.trim(),
        color,
        emoji: emoji.trim() || undefined,
      };
      validateNetWorthItem(draft);
      await onSave(draft, item?.id);
    } catch (error) {
      setErr(errorMessage(error));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={item ? "Edit net worth item" : "Add asset or liability"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{item ? "Edit item" : "Add asset or liability"}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="form-grid">
          {err && (
            <div className="error" role="alert">
              {err}
            </div>
          )}
          <label>
            Type
            <select
              value={kind}
              onChange={(e) => handleKindChange(e.target.value as NetWorthKind)}
            >
              <option value="asset">Asset (you own)</option>
              <option value="liability">Liability (you owe)</option>
            </select>
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(e) =>
                handleCategoryChange(e.target.value as NetWorthCategory)
              }
            >
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {NET_WORTH_CATEGORIES[c].emoji}{" "}
                  {NET_WORTH_CATEGORIES[c].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              ref={nameRef}
              required
              maxLength={80}
              placeholder={
                kind === "asset"
                  ? "e.g. Global ETF Portfolio"
                  : "e.g. Auto Loan"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Current value (AED)
            <input
              required
              inputMode="decimal"
              placeholder="0.00"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
            />
          </label>
          <label>
            As of date
            <input
              type="date"
              required
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              Emoji
              <input
                maxLength={16}
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea
              rows={2}
              maxLength={500}
              placeholder="Optional details (institution, weight, rate...)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving…" : item ? "Save changes" : "Add item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function NetWorthValuationModal({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: NetWorthItem;
  busy: boolean;
  onClose: () => void;
  onSave: (
    item: NetWorthItem,
    value: number,
    date: string,
    notes: string,
  ) => Promise<void>;
}) {
  const [valueInput, setValueInput] = useState(
    (item.current_value / 100).toFixed(2),
  );
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const valRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    valRef.current?.focus();
    valRef.current?.select();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const value = minor(valueInput);
      validateNetWorthSnapshot({
        item_id: item.id,
        value,
        date,
        notes: notes.trim(),
      });
      await onSave(item, value, date, notes.trim());
    } catch (error) {
      setErr(errorMessage(error));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Update valuation for ${item.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Update valuation · {item.name}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="form-grid">
          {err && (
            <div className="error" role="alert">
              {err}
            </div>
          )}
          <label>
            New value (AED)
            <input
              ref={valRef}
              required
              inputMode="decimal"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
            />
          </label>
          <label>
            Valuation date
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Notes
            <input
              maxLength={500}
              placeholder="e.g. Monthly statement update"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Recording…" : "Save valuation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
