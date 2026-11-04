import { ColorPicker, EmojiField } from "./Appearance";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { backend, type Session } from "./client";
import { CsvImport } from "./CsvImport";
import type { ImportTransaction } from "./csv";
import { ThemeToggle } from "./ThemeToggle";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Plus,
  LayoutDashboard,
  Wallet,
  Tags,
  ReceiptText,
  LogOut,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Leaf,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  balance,
  emptyLedger,
  minor,
  money,
  today,
  totals,
  validateTransaction,
  type Account,
  type AccountType,
  type Category,
  type Kind,
  type Ledger,
  type Transaction,
} from "./domain";
import { demoLedger } from "./demo";
import "./style.css";
function demoId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(
    bytes,
    (b, i) =>
      ([4, 6, 8, 10].includes(i) ? "-" : "") + b.toString(16).padStart(2, "0"),
  ).join("");
}
const types: Record<AccountType, string> = {
  current: "Current",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
  other: "Other",
};
const colors = [
  "#1d5b48",
  "#b08448",
  "#696198",
  "#619a92",
  "#b86e69",
  "#768db1",
];
type Modal =
  | { kind: "account"; item?: Account }
  | { kind: "category"; item?: Category }
  | { kind: "transaction"; item?: Transaction }
  | null;
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [checking, setChecking] = useState(!!backend),
    [demo, setDemo] = useState(false),
    [ledger, setLedger] = useState<Ledger>(emptyLedger),
    [page, setPage] = useState("Overview"),
    [modal, setModal] = useState<Modal>(null),
    [importOpen, setImportOpen] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [accountFilter, setAccountFilter] = useState(""),
    [kindFilter, setKindFilter] = useState(""),
    [month, setMonth] = useState(today().slice(0, 7)),
    [view, setView] = useState("month"),
    [hidden, setHidden] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!backend) return;
    backend
      .getSession()
      .then(setSession)
      .catch((e) => setError(message(e)))
      .finally(() => setChecking(false));
    return backend.subscribe((s) => {
      setSession(s);
      if (!s) {
        generation.current++;
        setLedger(emptyLedger);
      }
    });
  }, []);
  async function load() {
    if (!backend || !session) return;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await backend.load();
      if (current === generation.current) setLedger(data);
    } catch (e) {
      if (current === generation.current) setError(message(e));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (session && !demo) void load();
  }, [session?.user.id, demo]);
  function startDemo() {
    setDemo(true);
    setLedger(demoLedger());
    setPage("Overview");
    setError("");
  }
  async function save(
    table: "accounts" | "categories" | "transactions",
    value: Record<string, unknown>,
    id?: string,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      if (demo) {
        const next = { ...value, id: id ?? demoId() };
        setLedger(
          (l) =>
            ({
              ...l,
              [table]: id
                ? l[table].map((v) => (v.id === id ? next : v))
                : [...l[table], next],
            }) as Ledger,
        );
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        await backend.save(table, value, id);
        await load();
      }
      setModal(null);
    } finally {
      setBusy(false);
    }
  }
  async function importTransactions(
    rows: ImportTransaction[],
    progress: (n: number) => void,
  ) {
    if (busy) throw new Error("Another operation is running.");
    setBusy(true);
    const current = generation.current;
    try {
      rows.forEach((row) => validateTransaction(row, ledger));
      if (demo) {
        setLedger((l) => ({
          ...l,
          transactions: [
            ...l.transactions,
            ...rows.map((row) => ({ ...row, id: demoId() })),
          ],
        }));
        progress(rows.length);
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        await backend.createMany(
          "transactions",
          rows,
          (saved) => progress(saved),
          () => generation.current === current,
        );
      }
    } finally {
      if (!demo && generation.current === current) await load();
      setBusy(false);
    }
  }
  async function createCategories(
    rows: Omit<Category, "id">[],
    progress: (n: number) => void,
  ) {
    if (busy) throw new Error("Another operation is running.");
    setBusy(true);
    const current = generation.current;
    try {
      if (rows.some((row) => !row.name.trim() || row.name.length > 80))
        throw new Error("Category names must contain 1–80 characters.");
      if (demo) {
        setLedger((l) => ({
          ...l,
          categories: [
            ...l.categories,
            ...rows.map((row) => ({ ...row, id: demoId() })),
          ],
        }));
        progress(rows.length);
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        await backend.createMany(
          "categories",
          rows,
          (saved, records) => {
            setLedger((l) => ({
              ...l,
              categories: [...l.categories, ...records],
            }));
            progress(saved);
          },
          () => generation.current === current,
        );
      }
    } finally {
      if (!demo && generation.current === current) await load();
      setBusy(false);
    }
  }
  async function remove(
    table: "accounts" | "categories" | "transactions",
    id: string,
  ) {
    if (!window.confirm("Delete this item? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      if (
        table === "accounts" &&
        ledger.transactions.some(
          (t) => t.account_id === id || t.to_account_id === id,
        )
      )
        throw new Error("Delete or move this account’s transactions first.");
      if (
        table === "categories" &&
        ledger.transactions.some((t) => t.category_id === id)
      )
        throw new Error("Reassign this category’s transactions first.");
      if (demo)
        setLedger((l) => ({
          ...l,
          [table]: l[table].filter((v) => v.id !== id),
        }));
      else {
        if (!backend || !session) throw new Error("Please sign in.");
        await backend.remove(table, id);
        await load();
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (checking) return <div className="loading">Opening Fuloos…</div>;
  if (!session && !demo)
    return <Auth onDemo={startDemo} externalError={error} />;
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const start = new Date(`${month}-01T00:00:00Z`);
  if (view === "3" || view === "6" || view === "12") start.setUTCMonth(start.getUTCMonth() - Number(view) + 1);
  if (view === "ytd") start.setUTCMonth(0);
  const rangeLabel = view === "all" ? "All time" : `${start.toISOString().slice(0, 10)} – ${new Date(end.getTime() - 86400000).toISOString().slice(0, 10)}`;
  const monthly = ledger.transactions.filter((t) => view === "all" || (t.date >= start.toISOString().slice(0, 10) && t.date < end.toISOString().slice(0, 10))),
    summary = totals(monthly),
    net = ledger.accounts.reduce(
      (s, a) => s + balance(a, ledger.transactions),
      0,
    );
  const filtered = monthly
    .filter(
      (t) =>
        (!accountFilter ||
          t.account_id === accountFilter ||
          t.to_account_id === accountFilter) &&
        (!kindFilter || t.type === kindFilter) &&
        [
          t.payee,
          t.notes,
          ledger.categories.find((c) => c.id === t.category_id)?.name ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const spending = ledger.categories
    .map((c) => ({
      ...c,
      total: monthly
        .filter((t) => t.type === "expense" && t.category_id === c.id)
        .reduce((s, t) => s + t.amount, 0),
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const uncategorized = monthly
    .filter((t) => t.type === "expense" && !t.category_id)
    .reduce((s, t) => s + t.amount, 0);
  if (uncategorized)
    spending.push({
      id: "uncategorized",
      name: "Uncategorized",
      description: "",
      color: "#929b96",
      total: uncategorized,
    });
  function moveMonth(n: number) {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  }
  const concealed = (v: number) => (hidden ? "••••••" : money(v));
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("Overview");
          }}
        >
          <span className="brand-icon">
            <Leaf size={23} />
          </span>
          fuloos<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {[
            { name: "Overview", icon: LayoutDashboard },
            { name: "Transactions", icon: ReceiptText },
            { name: "Reports", icon: LayoutDashboard },
            { name: "Accounts", icon: Wallet },
            { name: "Categories", icon: Tags },
          ].map(({ name, icon: Icon }) => (
            <button
              className={`nav-item ${page === name ? "active" : ""}`}
              key={name}
              onClick={() => {
                setPage(name);
                setSearch("");
                setAccountFilter("");
                setKindFilter("");
              }}
            >
              <Icon size={19} />
              {name}
              {page === name && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-leaf">
            <Leaf size={19} />
          </span>
          <b>A little clarity goes a long way.</b>
          <p>Make room for what matters. One transaction at a time.</p>
        </div>
        <div className="profile">
          <span className="avatar">
            {demo ? "D" : session?.user.email?.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <b>
              {demo ? "Demo workspace" : session?.user.email?.split("@")[0]}
            </b>
            <small>
              {demo ? "Sample data · not saved" : "Personal workspace"}
            </small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={async () => {
              if (demo) {
                setDemo(false);
                setLedger(emptyLedger);
              } else {
                backend?.signOut();
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Personal finance <span className="slash">/</span> <b>{page}</b>
          </span>
          <div className="topbar-right">
            <ThemeToggle />
            <span className="currency-pill">
              AED <span>United Arab Emirates</span>
            </span>
            <span className="small-avatar">
              {demo ? "D" : session?.user.email?.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <div className="content">
          {demo && (
            <div className="demo-banner">
              <span>
                You're exploring a sample workspace. Changes last until you
                leave.
              </span>
              <button
                onClick={() => {
                  setDemo(false);
                  setLedger(emptyLedger);
                }}
              >
                Sign in to save <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR MONEY, IN VIEW</div>
              <h1>{page === "Overview" ? "A clearer picture." : page}</h1>
              <p>
                {page === "Overview"
                  ? "Your everyday finances, all in one calm place."
                  : page === "Accounts"
                    ? "Every account. One place to see where you stand."
                    : page === "Categories"
                      ? "Organize your money in a way that makes sense to you."
                      : "The small details behind the bigger picture."}
              </p>
            </div>
            <button
              className="primary"
              disabled={loading || busy}
              onClick={() =>
                setModal({
                  kind:
                    page === "Accounts"
                      ? "account"
                      : page === "Categories"
                        ? "category"
                        : "transaction",
                })
              }
            >
              <Plus size={18} />
              {page === "Accounts"
                ? "Add account"
                : page === "Categories"
                  ? "Add category"
                  : "Add transaction"}
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              {error} <button onClick={() => void load()}>Retry</button>
            </div>
          )}
          {loading && (
            <div className="loading-inline" role="status">
              Loading your workspace…
            </div>
          )}
          {(page === "Overview" || page === "Transactions" || page === "Reports") && (
            <div className="period-row">
              <select aria-label="Date range" value={view} onChange={(e) => { setView(e.target.value); setMonth(today().slice(0, 7)); }}>
                <option value="month">Month</option><option value="3">3 months</option><option value="6">6 months</option><option value="ytd">Year to date</option><option value="12">1 year</option><option value="all">All time</option>
              </select>
              <div className="month-control">
                <button
                  className="icon-button"
                  aria-label="Previous month"
                  onClick={() => moveMonth(-1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {new Date(`${month}-15T12:00:00Z`).toLocaleDateString(
                    "en-GB",
                    { month: "long", year: "numeric", timeZone: "Asia/Dubai" },
                  )}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next month"
                  onClick={() => moveMonth(1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <span className="muted">
                {rangeLabel}
              </span>
            </div>
          )}
          {page === "Overview" && (
            <>
              <section className="stats">
                <article className="stat net">
                  <div className="stat-label">
                    Total net balance{" "}
                    <button
                      className="icon-button"
                      aria-label={hidden ? "Show balances" : "Hide balances"}
                      onClick={() => setHidden(!hidden)}
                    >
                      {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <h2>{concealed(net)}</h2>
                  <small>
                    Across {ledger.accounts.length} accounts{" "}
                    <span>Including credit balances</span>
                  </small>
                  <div className="stat-decoration" />
                </article>
                <article className="stat">
                  <div className="stat-label">
                    Income{" "}
                    <span className="round-icon green">
                      <ArrowDownLeft size={19} />
                    </span>
                  </div>
                  <h2>{concealed(summary.income)}</h2>
                  <small>
                    Money coming in{" "}
                    <span className="green-text">{rangeLabel}</span>
                  </small>
                </article>
                <article className="stat">
                  <div className="stat-label">
                    Expenses{" "}
                    <span className="round-icon terracotta">
                      <ArrowUpRight size={19} />
                    </span>
                  </div>
                  <h2>{concealed(summary.expense)}</h2>
                  <small>
                    Money going out <span>{rangeLabel}</span>
                  </small>
                </article>
              </section>
              <section className="section">
                <div className="section-title">
                  <h2>
                    Your accounts{" "}
                    <span className="count">{ledger.accounts.length}</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => setPage("Accounts")}
                  >
                    View all accounts <ArrowRight size={15} />
                  </button>
                </div>
                <div className="account-grid">
                  {ledger.accounts.slice(0, 3).map((a) => (
                    <button
                      className="account-card"
                      key={a.id}
                      onClick={() => {
                        setAccountFilter(a.id);
                        setPage("Transactions");
                      }}
                    >
                      <div className="account-top">
                        <span
                          className="account-symbol"
                          style={{ background: a.color + "18", color: a.color }}
                        >
                          {a.emoji || <Wallet size={20} />}
                        </span>
                        <span className="account-kind">{types[a.type]}</span>
                      </div>
                      <h3>{a.name}</h3>
                      <div className="account-bottom">
                        <strong>
                          {concealed(balance(a, ledger.transactions))}
                        </strong>
                        <span>AED</span>
                      </div>
                    </button>
                  ))}
                  <button
                    className="add-account-card"
                    onClick={() => setModal({ kind: "account" })}
                  >
                    <span>
                      <Plus size={21} />
                    </span>
                    <b>Add an account</b>
                    <small>Bring your money together</small>
                  </button>
                </div>
              </section>
              <div className="overview-bottom">
                <section className="panel spending">
                  <div className="panel-heading">
                    <div>
                      <button className="text-button" onClick={() => setPage("Reports")}><h2>Where it went</h2><ArrowRight size={16} /></button>
                      <p>Your spending by category</p>
                    </div>
                    <Tags size={18} className="muted" />
                  </div>
                  {summary.expense > 0 ? (
                    <>
                      <div
                        className="donut"
                        style={{
                          background: `conic-gradient(${spending.map((c, i) => `${c.color} ${(spending.slice(0, i).reduce((s, v) => s + v.total, 0) / summary.expense) * 100}% ${(spending.slice(0, i + 1).reduce((s, v) => s + v.total, 0) / summary.expense) * 100}%`).join(",")})`,
                        }}
                      >
                        <div>
                          <small>TOTAL SPENT</small>
                          <b>{concealed(summary.expense)}</b>
                        </div>
                      </div>
                      <div className="category-legend">
                        {spending.map((c) => (
                          <div key={c.id}>
                            <span
                              className="color-dot"
                              style={{ background: c.color }}
                            />
                            <span>{c.name}</span>
                            <b>{concealed(c.total)}</b>
                            <small>
                              {Math.round((c.total / summary.expense) * 100)}%
                            </small>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="A little more detail, soon"
                      text="Add an expense to see where your money goes."
                    />
                  )}
                </section>
                <section className="panel recent">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <p>The latest in your money story</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("Transactions")}
                    >
                      View all <ArrowRight size={15} />
                    </button>
                  </div>
                  <TransactionList
                    items={monthly
                      .slice()
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .slice(0, 5)}
                    ledger={ledger}
                    concealed={concealed}
                    onEdit={(t) => setModal({ kind: "transaction", item: t })}
                  />
                </section>
              </div>
            </>
          )}
          {page === "Reports" && (
            <section className="panel">
              <div className="panel-heading"><h2>Where it went</h2><span>{rangeLabel}</span></div>
              <div className="filters"><b>Income {concealed(summary.income)}</b><b>Expenses {concealed(summary.expense)}</b><b>Net cash flow {concealed(summary.income - summary.expense)}</b></div>
              {spending.map(c => <div className="category-item" key={c.id}><span className="category-symbol" style={{color: c.color}}><Tags size={20}/></span><div><b>{c.name}</b><p>{(c.total / summary.expense * 100).toFixed(1)}% of spending</p><progress aria-label={`${c.name} share of spending`} value={c.total} max={summary.expense}/></div><strong>{concealed(c.total)}</strong></div>)}
              {!spending.length && <Empty title="No spending in this period" text="Choose another date range to explore your spending."/>}
            </section>
          )}
          {page === "Accounts" && (
            <>
              <div className="accounts-summary">
                <span>Total net balance</span>
                <strong>{concealed(net)}</strong>
                <small>
                  Credit card debt is shown as a negative balance. Enter a
                  negative opening balance for amounts you owe.
                </small>
              </div>
              <div className="account-grid full">
                {ledger.accounts.map((a) => (
                  <article className="account-card" key={a.id}>
                    <div className="account-top">
                      <span
                        className="account-symbol"
                        style={{ background: a.color + "18", color: a.color }}
                      >
                        {a.emoji || <Wallet size={22} />}
                      </span>
                      <span className="account-kind">{types[a.type]}</span>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Edit ${a.name}`}
                          onClick={() => setModal({ kind: "account", item: a })}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={busy}
                          aria-label={`Delete ${a.name}`}
                          onClick={() => void remove("accounts", a.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <h3>{a.name}</h3>
                    <strong className="large-amount">
                      {concealed(balance(a, ledger.transactions))}
                    </strong>
                    <p className="muted small">
                      Opening: {concealed(a.opening_balance)} · {a.opening_date}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setPage("Transactions");
                        setAccountFilter(a.id);
                      }}
                    >
                      View transactions <ArrowRight size={15} />
                    </button>
                  </article>
                ))}
                <button
                  className="add-account-card"
                  onClick={() => setModal({ kind: "account" })}
                >
                  <span>
                    <Plus size={22} />
                  </span>
                  <b>Add an account</b>
                  <small>Current, savings, credit card or cash</small>
                </button>
              </div>
            </>
          )}
          {page === "Categories" && (
            <div className="category-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>All categories</h2>
                  <span className="count">{ledger.categories.length}</span>
                </div>
                {ledger.categories.map((c) => (
                  <div className="category-item" key={c.id}>
                    <span
                      className="category-symbol"
                      style={{ color: c.color, background: c.color + "18" }}
                    >
                      {c.emoji || <Tags size={20} />}
                    </span>
                    <div>
                      <b>{c.name}</b>
                      <p>{c.description || "No description"}</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${c.name}`}
                      onClick={() => setModal({ kind: "category", item: c })}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Delete ${c.name}`}
                      onClick={() => void remove("categories", c.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {!ledger.categories.length && (
                  <Empty
                    title="Make it your own"
                    text="Create categories that fit your life."
                  />
                )}
              </section>
            </div>
          )}
          {page === "Transactions" && (
            <section className="panel">
              <div className="filters">
                <button
                  className="secondary"
                  disabled={busy || loading || !ledger.accounts.length}
                  onClick={() => setImportOpen(true)}
                >
                  Import CSV
                </button>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search transactions"
                    placeholder="Search transactions…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter account"
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
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
                  onChange={(e) => setKindFilter(e.target.value)}
                >
                  <option value="">All types</option>
                  <option value="expense">Expenses</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfers</option>
                </select>
                <span className="muted small">
                  {filtered.length} transactions
                </span>
              </div>
              <TransactionList
                items={filtered}
                ledger={ledger}
                concealed={concealed}
                onEdit={(t) => setModal({ kind: "transaction", item: t })}
                onDelete={(t) => void remove("transactions", t.id)}
                busy={busy}
              />
            </section>
          )}
          <footer>
            <Leaf size={14} />
            <span>A little more clarity. A little less worry.</span>
            <span className="footer-brand">Made for your everyday.</span>
          </footer>
        </div>
      </main>
      {importOpen && (
        <CsvImport
          ledger={ledger}
          onClose={() => setImportOpen(false)}
          onImport={importTransactions}
          onCreateCategories={createCategories}
          onCreateCategory={async (value) => {
            await save("categories", value);
          }}
        />
      )}
      {modal && (
        <Editor
          modal={modal}
          ledger={ledger}
          busy={busy}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          save={save}
        />
      )}
    </div>
  );
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Something went wrong. Please try again.";
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <ReceiptText size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TransactionList({
  items,
  ledger,
  concealed,
  onEdit,
  onDelete,
  busy,
}: {
  items: Transaction[];
  ledger: Ledger;
  concealed: (v: number) => string;
  onEdit: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
  busy?: boolean;
}) {
  const balances = new Map<string, Map<string, number>>();
  const running = new Map(ledger.accounts.map(a => [a.id, a.opening_balance]));
  // IDs provide a consistent order where only a transaction date is available.
  for (const t of [...ledger.transactions].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    running.set(t.account_id, (running.get(t.account_id) ?? 0) + (t.type === "income" ? t.amount : -t.amount));
    if (t.to_account_id) running.set(t.to_account_id, (running.get(t.to_account_id) ?? 0) + t.amount);
    balances.set(t.id, new Map(running));
  }
  return items.length ? (
    <div className="transaction-list">
      {items.map((t) => {
        const category = ledger.categories.find((c) => c.id === t.category_id);
        const account = ledger.accounts.find((a) => a.id === t.account_id);
        return (
          <div className="transaction-row" key={t.id}>
            <button className="transaction-main" onClick={() => onEdit(t)}>
              <span
                className={`transaction-icon ${t.type}`}
                style={
                  category
                    ? {
                        background: category.color + "15",
                        color: category.color,
                      }
                    : undefined
                }
              >
                {t.type === "transfer" ? (
                  <ArrowLeftRight size={19} />
                ) : t.type === "income" ? (
                  <ArrowDownLeft size={19} />
                ) : (
                  <ReceiptText size={19} />
                )}
              </span>
              <span className="transaction-description">
                <b>
                  {t.payee ||
                    (t.type === "transfer"
                      ? "Account transfer"
                      : "Transaction")}
                </b>
                <small>
                  {t.type === "transfer"
                    ? `${account?.name} → ${ledger.accounts.find((a) => a.id === t.to_account_id)?.name}`
                    : `${category?.name ?? "Uncategorized"} · ${account?.name}`}
                </small>
              </span>
              <span className="transaction-value">
                <small>{account?.name}: {concealed(balances.get(t.id)?.get(t.account_id) ?? 0)} balance</small>
                {t.to_account_id && <small>{ledger.accounts.find(a => a.id === t.to_account_id)?.name}: {concealed(balances.get(t.id)?.get(t.to_account_id) ?? 0)} balance</small>}
                <b className={t.type === "income" ? "green-text" : ""}>
                  {t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}
                  {concealed(t.amount)}
                </b>
                <small>
                  {new Date(t.date + "T12:00:00Z").toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Asia/Dubai",
                  })}
                </small>
              </span>
            </button>
            {onDelete && (
              <button
                disabled={busy}
                className="icon-button delete"
                aria-label={`Delete ${t.payee || "transaction"}`}
                onClick={() => onDelete(t)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  ) : (
    <Empty
      title="A fresh start"
      text="Add your first transaction, or try a different month or filter."
    />
  );
}
function Auth({
  onDemo,
  externalError,
}: {
  onDemo: () => void;
  externalError: string;
}) {
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    if (backend)
      backend
        .googleEnabled()
        .then((enabled) => {
          if (active) setGoogleAvailable(enabled);
        })
        .catch(() => {
          if (active) setGoogleAvailable(false);
        });
    else setGoogleAvailable(false);
    return () => {
      active = false;
    };
  }, []);
  function googleSignIn() {
    if (!backend || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    backend
      .signInWithGoogle()
      .catch((e) => setError(message(e)))
      .finally(() => setBusy(false));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!backend) {
      setError(
        "Live authentication is not connected yet. You can explore the demo below.",
      );
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        const result = await backend.signUp(email, password);
        if (result.verificationRequired)
          setNotice("Check your email to confirm your account, then sign in.");
        else if (!result.session) {
          setSignup(false);
          setNotice("Your account is ready. Sign in to continue.");
        }
      } else await backend.signIn(email, password);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Leaf size={24} />
          </span>
          fuloos.
        </a>
        <div>
          <div className="eyebrow">A LITTLE MORE CLARITY</div>
          <h1>
            Your money.
            <br />
            Your life.
            <br />
            <em>In balance.</em>
          </h1>
          <p>
            A calm space for your everyday finances.
            <br />
            Bring your accounts together and make room
            <br />
            for what matters.
          </p>
          <div className="auth-features">
            <span>
              <Check size={17} /> All your accounts, together
            </span>
            <span>
              <Check size={17} /> Categories that feel like you
            </span>
            <span>
              <Check size={17} /> Made for life in the UAE
            </span>
          </div>
        </div>
        <small>YOUR MONEY, IN VIEW.</small>
      </section>
      <section className="auth-side">
        <div className="auth-theme-toggle">
          <ThemeToggle />
        </div>
        <div className="auth-form">
          <span className="auth-tag">
            <Leaf size={16} /> Welcome to Fuloos
          </span>
          <h2>
            {signup ? "Make yourself at home." : "Good to have you here."}
          </h2>
          <p>
            {signup
              ? "Create your account and start with a clear view."
              : "Sign in to pick up where you left off."}
          </p>
          <button
            type="button"
            className="google-sign-in"
            disabled={busy || !googleAvailable}
            onClick={googleSignIn}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"
              />
              <path
                fill="#EA4335"
                d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 6Z"
              />
            </svg>
            {busy ? "Please wait…" : "Continue with Google"}
          </button>
          {googleAvailable === false && (
            <p className="google-setup-note">
              Google sign-in is awaiting setup. Email and password are available
              below.
            </p>
          )}
          <div className="auth-tabs">
            <button
              className={!signup ? "selected" : ""}
              onClick={() => {
                setSignup(false);
                setError("");
                setNotice("");
              }}
            >
              Sign in
            </button>
            <button
              className={signup ? "selected" : ""}
              onClick={() => {
                setSignup(true);
                setError("");
                setNotice("");
              }}
            >
              Sign up
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                minLength={8}
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={signup ? "At least 8 characters" : "Your password"}
              />
            </label>
            {(error || externalError) && (
              <div className="error" role="alert">
                {error || externalError}
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}
            <button className="primary auth-submit" disabled={busy}>
              {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-divider">
            <span>or take a look around</span>
          </div>
          <button className="demo-button" onClick={onDemo}>
            Explore the demo <ArrowRight size={16} />
          </button>
          {!backend && (
            <p className="setup-note">
              Preview mode · Live sign-in will be available once the database is
              connected.
            </p>
          )}
          <small className="auth-footnote">
            A clearer picture starts with one small step.
          </small>
        </div>
      </section>
    </div>
  );
}
function Editor({
  modal,
  ledger,
  busy,
  onClose,
  save,
}: {
  modal: NonNullable<Modal>;
  ledger: Ledger;
  busy: boolean;
  onClose: () => void;
  save: (
    table: "accounts" | "categories" | "transactions",
    value: Record<string, unknown>,
    id?: string,
  ) => Promise<void>;
}) {
  const item = modal.item;
  const [kind, setKind] = useState<Kind>(
      modal.kind === "transaction" && modal.item ? modal.item.type : "expense",
    ),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget),
      s = (key: string) => String(f.get(key) ?? "").trim();
    try {
      if (modal.kind === "account") {
        const value = {
          name: s("name"),
          type: s("type"),
          opening_balance: minor(s("opening_balance")),
          opening_date: s("opening_date"),
          color: s("color"),
          emoji: s("emoji"),
        };
        if (!value.name) throw new Error("Enter an account name.");
        if (
          item &&
          ledger.transactions.some(
            (t) =>
              (t.account_id === item.id || t.to_account_id === item.id) &&
              t.date < value.opening_date,
          )
        )
          throw new Error(
            "Opening date cannot be after an existing transaction.",
          );
        await save("accounts", value, item?.id);
      } else if (modal.kind === "category") {
        const value = {
          name: s("name"),
          description: s("description"),
          color: s("color"),
          emoji: s("emoji"),
        };
        if (!value.name) throw new Error("Enter a category name.");
        await save("categories", value, item?.id);
      } else {
        const value = {
          type: kind,
          amount: minor(s("amount")),
          account_id: s("account_id"),
          to_account_id: kind === "transfer" ? s("to_account_id") : null,
          category_id: kind === "transfer" ? null : s("category_id") || null,
          date: s("date"),
          payee: s("payee"),
          notes: s("notes"),
        };
        validateTransaction(value, ledger);
        await save("transactions", value, item?.id);
      }
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2 id="modal-title">
            {item ? "Edit" : "Add"} {modal.kind}
          </h2>
        </div>
        <button
          disabled={busy}
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={submit}>
        {modal.kind === "transaction" ? (
          <>
            {ledger.accounts.length === 0 && (
              <div className="notice">
                Create an account first to start adding transactions.
              </div>
            )}
            <div className="type-switch">
              {(["expense", "income", "transfer"] as const).map((k) => (
                <button
                  type="button"
                  className={kind === k ? "selected" : ""}
                  key={k}
                  onClick={() => setKind(k)}
                >
                  {k === "expense" ? (
                    <ArrowUpRight size={16} />
                  ) : k === "income" ? (
                    <ArrowDownLeft size={16} />
                  ) : (
                    <ArrowLeftRight size={16} />
                  )}{" "}
                  {k}
                </button>
              ))}
            </div>
            <label>
              Amount <span className="muted">AED</span>
              <input
                name="amount"
                autoFocus
                required
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={
                  modal.item ? (modal.item.amount / 100).toFixed(2) : ""
                }
              />
            </label>
            <div className="form-row">
              <label>
                {kind === "transfer" ? "From account" : "Account"}
                <select
                  name="account_id"
                  required
                  defaultValue={
                    modal.item?.account_id ?? ledger.accounts[0]?.id
                  }
                >
                  {ledger.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "transfer" ? (
                <label>
                  To account
                  <select
                    name="to_account_id"
                    required
                    defaultValue={modal.item?.to_account_id ?? ""}
                  >
                    <option value="" disabled>
                      Choose account
                    </option>
                    {ledger.accounts.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Category
                  <select
                    key={kind}
                    name="category_id"
                    defaultValue={
                      modal.item?.type === kind
                        ? (modal.item.category_id ?? "")
                        : ""
                    }
                  >
                    <option value="">Uncategorized</option>
                    {ledger.categories.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label>
              Date
              <input
                required
                name="date"
                type="date"
                defaultValue={modal.item?.date ?? today()}
              />
            </label>
            <label>
              {kind === "transfer" ? "Description" : "Payee / description"}
              <input
                name="payee"
                maxLength={160}
                defaultValue={modal.item?.payee}
                placeholder={
                  kind === "income"
                    ? "e.g. Monthly salary"
                    : kind === "transfer"
                      ? "e.g. Moving to savings"
                      : "e.g. Spinneys"
                }
              />
            </label>
            <label>
              Notes <span className="muted">Optional</span>
              <textarea
                name="notes"
                maxLength={1000}
                defaultValue={modal.item?.notes}
                placeholder="Anything you’d like to remember"
              />
            </label>
            {kind === "transfer" && (
              <p className="form-hint">
                Both accounts update together. Transfers are excluded from
                income and expenses.
              </p>
            )}
          </>
        ) : modal.kind === "account" ? (
          <>
            <label>
              Account name
              <input
                required
                autoFocus
                name="name"
                maxLength={80}
                defaultValue={modal.item?.name}
                placeholder="e.g. My everyday account"
              />
            </label>
            <label>
              Account type
              <select name="type" defaultValue={modal.item?.type ?? "current"}>
                {Object.entries(types).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                Opening balance (AED)
                <input
                  required
                  inputMode="decimal"
                  name="opening_balance"
                  defaultValue={
                    modal.item
                      ? (modal.item.opening_balance / 100).toFixed(2)
                      : "0.00"
                  }
                />
              </label>
              <label>
                As of date
                <input
                  required
                  name="opening_date"
                  type="date"
                  defaultValue={modal.item?.opening_date ?? today()}
                />
              </label>
            </div>
            <p className="form-hint">
              Use a negative balance for credit card debt or an overdraft.
              Opening balances do not count as income. Phase 1 supports AED
              accounts.
            </p>
            <EmojiField defaultValue={modal.item?.emoji} />
            <ColorPicker
              defaultValue={
                modal.item?.color ??
                colors[ledger.accounts.length % colors.length]
              }
            />
          </>
        ) : (
          <>
            <label>
              Category name
              <input
                autoFocus
                required
                name="name"
                maxLength={80}
                defaultValue={modal.item?.name}
                placeholder="e.g. Coffee & cafés"
              />
            </label>
            <p className="form-hint">
              Use this category for both income and expenses.
            </p>
            <label>
              Description <span className="muted">Optional</span>
              <textarea
                name="description"
                maxLength={500}
                defaultValue={modal.item?.description}
                placeholder="What belongs in this category?"
              />
            </label>
            <EmojiField defaultValue={modal.item?.emoji} />
            <ColorPicker
              defaultValue={
                modal.item?.color ??
                colors[ledger.categories.length % colors.length]
              }
            />
          </>
        )}
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
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              busy || (modal.kind === "transaction" && !ledger.accounts.length)
            }
          >
            {busy ? "Saving…" : item ? "Save changes" : `Add ${modal.kind}`}
            <Check size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

