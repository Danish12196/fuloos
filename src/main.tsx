import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
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
import { supabase } from "./client";
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
    [checking, setChecking] = useState(!!supabase),
    [demo, setDemo] = useState(false),
    [ledger, setLedger] = useState<Ledger>(emptyLedger),
    [page, setPage] = useState("Overview"),
    [modal, setModal] = useState<Modal>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [accountFilter, setAccountFilter] = useState(""),
    [kindFilter, setKindFilter] = useState(""),
    [month, setMonth] = useState(today().slice(0, 7)),
    [hidden, setHidden] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setSession(data.session);
        setChecking(false);
      })
      .catch((e) => {
        setError(String(e));
        setChecking(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        generation.current++;
        setLedger(emptyLedger);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  async function load() {
    if (!supabase || !session) return;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      async function rows(table: "accounts" | "categories" | "transactions") {
        const all: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase!
            .from(table)
            .select("*")
            .order("id")
            .range(offset, offset + 499);
          if (error) throw error;
          all.push(...data);
          if (data.length < 500) break;
        }
        return all;
      }
      const results = await Promise.all([
        rows("accounts"),
        rows("categories"),
        rows("transactions"),
      ]);
      if (current === generation.current)
        setLedger({
          accounts: results[0],
          categories: results[1],
          transactions: results[2],
        } as unknown as Ledger);
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
        if (!supabase || !session) throw new Error("Please sign in.");
        const result = id
          ? await supabase
              .from(table)
              .update(value)
              .eq("id", id)
              .eq("user_id", session.user.id)
              .select()
              .single()
          : await supabase
              .from(table)
              .insert({ ...value, user_id: session.user.id })
              .select()
              .single();
        if (result.error) throw result.error;
        await load();
      }
      setModal(null);
    } finally {
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
        if (!supabase || !session) throw new Error("Please sign in.");
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("id", id)
          .eq("user_id", session.user.id);
        if (error) throw error;
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
  const monthly = ledger.transactions.filter((t) => t.date.startsWith(month)),
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
    .sort((a, b) => b.date.localeCompare(a.date));
  const spending = ledger.categories
    .filter((c) => c.type === "expense")
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
      type: "expense",
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
                const r = await supabase?.auth.signOut();
                if (r?.error) setError(r.error.message);
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
          {(page === "Overview" || page === "Transactions") && (
            <div className="period-row">
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
                A fresh perspective on your finances
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
                    <span className="green-text">This month</span>
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
                    Money going out <span>This month</span>
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
                          <Wallet size={20} />
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
                      <h2>Where it went</h2>
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
                        <Wallet size={22} />
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
              {(["expense", "income"] as const).map((type) => (
                <section className="panel" key={type}>
                  <div className="panel-heading">
                    <h2>
                      {type === "expense" ? "Expense" : "Income"} categories
                    </h2>
                    <span className="count">
                      {ledger.categories.filter((c) => c.type === type).length}
                    </span>
                  </div>
                  {ledger.categories
                    .filter((c) => c.type === type)
                    .map((c) => (
                      <div className="category-item" key={c.id}>
                        <span
                          className="category-symbol"
                          style={{ color: c.color, background: c.color + "18" }}
                        >
                          <Tags size={20} />
                        </span>
                        <div>
                          <b>{c.name}</b>
                          <p>{c.description || "No description"}</p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Edit ${c.name}`}
                          onClick={() =>
                            setModal({ kind: "category", item: c })
                          }
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
                  {!ledger.categories.some((c) => c.type === type) && (
                    <Empty
                      title="Make it your own"
                      text="Create categories that fit your life."
                    />
                  )}
                </section>
              ))}
            </div>
          )}
          {page === "Transactions" && (
            <section className="panel">
              <div className="filters">
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
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!supabase) {
      setError(
        "Live authentication is not connected yet. You can explore the demo below.",
      );
      return;
    }
    setBusy(true);
    try {
      const { data, error } = signup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (signup && !data.session)
        setNotice("Check your email to confirm your account, then sign in.");
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
          {!supabase && (
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
          type: s("type"),
          description: s("description"),
          color: s("color"),
        };
        if (!value.name) throw new Error("Enter a category name.");
        if (
          item &&
          ledger.transactions.some(
            (t) => t.category_id === item.id && t.type !== value.type,
          )
        )
          throw new Error(
            "This category has transactions. Its type cannot be changed.",
          );
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
                    {ledger.categories
                      .filter((c) => c.type === kind)
                      .map((c) => (
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
            <label>
              Account color
              <input
                type="color"
                name="color"
                defaultValue={
                  modal.item?.color ??
                  colors[ledger.accounts.length % colors.length]
                }
              />
            </label>
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
            <label>
              Type
              <select name="type" defaultValue={modal.item?.type ?? "expense"}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label>
              Description <span className="muted">Optional</span>
              <textarea
                name="description"
                maxLength={500}
                defaultValue={modal.item?.description}
                placeholder="What belongs in this category?"
              />
            </label>
            <label>
              Category color
              <input
                type="color"
                name="color"
                defaultValue={
                  modal.item?.color ??
                  colors[ledger.categories.length % colors.length]
                }
              />
            </label>
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
