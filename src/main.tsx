import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  backend,
  createLearningStore,
  createPresetStore,
  type Session,
} from "./client";
import { ConfirmHost } from "./ConfirmHost";
import { confirmDialog } from "./dialogStore";
import { QueueDock, useLeaveWarning, useQueue } from "./QueueDock";
import { TaskQueue } from "./taskQueue";
import { rebaseEdit } from "./bulk";
import { type BudgetDraft } from "./BudgetsView";
import { validateBudget } from "./budgets";
import { TransactionsPanel } from "./TransactionTable";
import { useDensity } from "./density";
import { Auth } from "./Auth";
import { type EditorModalState } from "./EditorModal";
import { OverviewPage, type SpendingItem } from "./OverviewPage";
import { AccountsPage } from "./AccountsPage";
import { CategoriesPage } from "./CategoriesPage";
import { SchemaBanner } from "./SchemaBanner";
import { checkSchemaStatus, type SchemaStatus } from "./schemaStatus";
import { AppLockScreen } from "./AppLock";
import { SecuritySettings } from "./SecuritySettings";
import {
  clearAppLock,
  loadAppLock,
  loadIdleSessionTimeout,
  shouldLockForIdle,
  shouldSignOutForIdle,
  type AppLockConfig,
  type StorageLike,
} from "./appLock";
const BudgetsPage = lazy(() =>
  import("./BudgetsView").then((m) => ({ default: m.BudgetsPage })),
);
const RecurringPage = lazy(() =>
  import("./RecurringView").then((m) => ({ default: m.RecurringPage })),
);
const ReportsPage = lazy(() =>
  import("./ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const GoalsPage = lazy(() =>
  import("./GoalsView").then((m) => ({ default: m.GoalsPage })),
);
const NetWorthPage = lazy(() =>
  import("./NetWorthView").then((m) => ({ default: m.NetWorthPage })),
);
import {
  GoalContributeModal,
  GoalEditorModal,
  type GoalDraft,
} from "./GoalsView";
import {
  NetWorthItemEditorModal,
  NetWorthValuationModal,
  type NetWorthItemDraft,
} from "./NetWorthView";
import type { NetWorthItem, NetWorthSnapshot } from "./netWorth";
import { applyContributionAmount } from "./goals";
import { useRecurringActions } from "./useRecurringActions";
import { useDeletionActions } from "./useDeletionActions";
import { useImportAndBulk } from "./useImportAndBulk";
import {
  executeRestore,
  type FuloosBackup,
  type RestoreMode,
} from "./backup";
import { Sidebar } from "./Sidebar";
import { AppModals } from "./AppModals";
import { AppPageHeader, AppTopbar } from "./AppHeader";
import { pendingCapturedAlerts } from "./captureAlerts";
import type { ImportTransaction } from "./csv";
import type { CapturedAlert } from "./domain";
import { Leaf } from "lucide-react";
import {
  balance,
  balanceAsOfDate,
  emptyLedger,
  errorMessage,
  hasBalanceAnchor,
  money,
  shiftMonth,
  today,
  totals,
  validateTransaction,
  type Account,
  type Budget,
  type GoalContribution,
  type Ledger,
  type SavingsGoal,
  type Transaction,
  type TransactionRule,
} from "./domain";
import { transactionCategoryAmounts } from "./enrichment";
import { validateRule } from "./rules";
import { demoLedger } from "./demo";
import "./style.css";
import {
  isPeriodSpan,
  monthsBetween,
  periodLabel,
  periodMonths,
} from "./period";
import {
  registerServiceWorker,
  useInstallPrompt,
  useOnlineStatus,
} from "./pwa";
import { PwaBanners, QuickAddFab, QuickAddModal } from "./QuickAdd";
import { parseQuickAddUrl, type QuickAddDraft } from "./quickAdd";
import { LocaleProvider, useLocale } from "./i18n";
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
type Modal = EditorModalState;
function App() {
  const { t } = useLocale();
  const [session, setSession] = useState<Session | null>(null),
    [checking, setChecking] = useState(!!backend),
    [demo, setDemo] = useState(false),
    [ledger, setLedger] = useState<Ledger>(emptyLedger),
    [page, setPage] = useState("Overview"),
    [modal, setModal] = useState<Modal>(null),
    [importOpen, setImportOpen] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [accountFilter, setAccountFilter] = useState(""),
    [kindFilter, setKindFilter] = useState(""),
    [month, setMonth] = useState(today().slice(0, 7)),
    [view, setView] = useState("month"),
    [rangeFrom, setRangeFrom] = useState(today().slice(0, 7)),
    [hidden, setHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const appStorage = useMemo<StorageLike | undefined>(() => {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  }, []);
  const [lockConfig, setLockConfig] = useState<AppLockConfig | null>(null);
  const [locked, setLocked] = useState(false);
  const [idleSignOutMinutes, setIdleSignOutMinutes] = useState(0);
  const lastActiveRef = useRef(Date.now());
  const bootCheckedRef = useRef(false);
  const [density] = useDensity();
  const [smsOpen, setSmsOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [captureAlertsOpen, setCaptureAlertsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [bulkItems, setBulkItems] = useState<Transaction[] | null>(null);
  const [budgetModal, setBudgetModal] = useState<{
    item?: Budget;
    draft?: Partial<BudgetDraft>;
  } | null>(null);
  const [goalModal, setGoalModal] = useState<{
    open: true;
    item?: SavingsGoal;
  } | null>(null);
  const [goalContributeTarget, setGoalContributeTarget] =
    useState<SavingsGoal | null>(null);
  const [netWorthModal, setNetWorthModal] = useState<{
    open: true;
    item?: NetWorthItem;
  } | null>(null);
  const [netWorthValuationTarget, setNetWorthValuationTarget] =
    useState<NetWorthItem | null>(null);
  const online = useOnlineStatus();
  const { canInstall, promptInstall } = useInstallPrompt();
  const [swUpdate, setSwUpdate] = useState<(() => void) | null>(null);
  const [quickAdd, setQuickAdd] = useState<Partial<QuickAddDraft> | null>(() => {
    const parsed = parseQuickAddUrl(window.location.search);
    if (parsed.open) {
      window.history.replaceState(
        {},
        "",
        window.location.pathname + window.location.hash,
      );
      return parsed.draft;
    }
    return null;
  });
  useEffect(
    () => registerServiceWorker((apply) => setSwUpdate(() => apply)),
    [],
  );
  useEffect(() => {
    if (!session && !demo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      setQuickAdd({});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, demo]);
  const generation = useRef(0);
  // Background saves keep running while the user moves between pages.
  const queue = useMemo(() => new TaskQueue(), []);
  const owner = useRef<string | null>(null);
  owner.current = demo ? null : (session?.user.id ?? null);
  const { pending: queuePending } = useQueue(queue);
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  // Records saved by queued tasks, so a later task builds on them even
  // before React has re-rendered with the new ledger.
  const savedTx = useRef(new Map<string, Transaction>());
  function latestTransaction(id: string) {
    return (
      savedTx.current.get(id) ??
      ledgerRef.current.transactions.find((t) => t.id === id)
    );
  }
  useLeaveWarning(queuePending);
  /** Queued work only runs for the account that queued it. */
  function ownerGuard() {
    const id = owner.current;
    if (!id) throw new Error("Please sign in.");
    return () => owner.current === id;
  }
  function checkOwner(stillOwner: () => boolean) {
    if (!stillOwner())
      throw new Error(
        "You signed out before this finished. Nothing more was saved.",
      );
  }
  /** Add saved records, skipping any a reload already brought in. */
  function mergeRecords<K extends "transactions" | "categories">(
    table: K,
    records: Ledger[K],
  ) {
    if (table === "transactions")
      for (const r of records as Transaction[]) savedTx.current.set(r.id, r);
    setLedger((l) => {
      const byId = new Map(records.map((r) => [r.id, r]));
      const kept = (l[table] as Ledger[K]).map((r) => {
        const next = byId.get(r.id);
        if (next) byId.delete(r.id);
        return next ?? r;
      });
      return { ...l, [table]: [...kept, ...byId.values()] } as Ledger;
    });
  }
  const learningStore = useMemo(
    () => createLearningStore(!demo && !!session),
    [demo, session?.user.id],
  );
  const presetStore = useMemo(
    () => createPresetStore(!demo && !!session),
    [demo, session?.user.id],
  );
  useEffect(() => {
    setSelected(new Set());
    setSelectedCategories(new Set());
    setCategoriesToDelete(null);
    setTransactionsToDelete(null);
    setBudgetModal(null);
    setGoalModal(null);
    setGoalContributeTarget(null);
    setBulkItems(null);
    setRecurringModal(null);
    setConfirmOcc(null);
    setRecurringTab("schedules");
    setRecurringFilter("all");
    queue.cancelQueued();
  }, [session?.user.id, demo]);
  function toggleCategory(id: string) {
    setSelectedCategories((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelection(id: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function updateTransactions(records: Transaction[]) {
    for (const r of records) savedTx.current.set(r.id, r);
    const byId = new Map(records.map((t) => [t.id, t]));
    setLedger((l) => ({
      ...l,
      transactions: l.transactions.map((t) => byId.get(t.id) ?? t),
    }));
    setSelected((old) => new Set([...old].filter((id) => !byId.has(id))));
  }
  useEffect(() => {
    if (!backend) return;
    backend
      .getSession()
      .then((s) => {
        if (s && !bootCheckedRef.current) {
          const cfg = loadAppLock(appStorage, s.user.id);
          if (cfg?.lockOnReopen) setLocked(true);
        }
        bootCheckedRef.current = true;
        setSession(s);
      })
      .catch((e) => {
        bootCheckedRef.current = true;
        setError(errorMessage(e));
      })
      .finally(() => setChecking(false));
    return backend.subscribe((s) => {
      setSession(s);
      if (!s) {
        generation.current++;
        setLedger(emptyLedger);
        setLocked(false);
        setLockConfig(null);
      }
    });
  }, []);
  useEffect(() => {
    if (!session || demo) {
      setLockConfig(null);
      setLocked(false);
      setIdleSignOutMinutes(0);
      return;
    }
    setLockConfig(loadAppLock(appStorage, session.user.id));
    setIdleSignOutMinutes(loadIdleSessionTimeout(appStorage, session.user.id));
    lastActiveRef.current = Date.now();
  }, [session?.user.id, demo, appStorage]);
  useEffect(() => {
    if (!session || demo) return;
    const bump = () => {
      if (!locked) lastActiveRef.current = Date.now();
    };
    const checkIdle = () => {
      const now = Date.now();
      if (shouldSignOutForIdle(lastActiveRef.current, now, idleSignOutMinutes)) {
        setError("Signed out due to inactivity.");
        backend?.signOut();
        return;
      }
      if (
        !locked &&
        lockConfig &&
        shouldLockForIdle(lastActiveRef.current, now, lockConfig.idleMinutes)
      ) {
        setLocked(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkIdle();
    };
    window.addEventListener("pointerdown", bump, { passive: true });
    window.addEventListener("keydown", bump, { passive: true });
    window.addEventListener("touchstart", bump, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(checkIdle, 15_000);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("touchstart", bump);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [session?.user.id, demo, locked, lockConfig, idleSignOutMinutes]);
  async function load() {
    if (!backend || !session) return;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [data, alertsRes] = await Promise.all([
        backend.load(),
        backend.loadCapturedAlerts().catch(() => ({ alerts: [], supported: false })),
      ]);
      if (current === generation.current) {
        savedTx.current.clear();
        setLedger({ ...data, captured_alerts: alertsRes.alerts });
      }
    } catch (e) {
      if (current === generation.current) setError(errorMessage(e));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (session && !demo) void load();
  }, [session?.user.id, demo]);
  const [schemaStatus, setSchemaStatus] = useState<SchemaStatus | null>(null);
  const [schemaDismissed, setSchemaDismissed] = useState(false);
  useEffect(() => {
    if (!backend || !session || demo) {
      setSchemaStatus(null);
      setSchemaDismissed(false);
      return;
    }
    let active = true;
    const api = backend;
    checkSchemaStatus((table) => api.probeCollection(table)).then((status) => {
      if (active) setSchemaStatus(status);
    });
    return () => {
      active = false;
    };
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
    options?: { receiptFile?: File | null; removeReceipt?: boolean },
  ) {
    if (!demo && !online) {
      throw new Error("You're offline. Reconnect to save changes.");
    }
    if (busy) throw new Error("Another operation is running.");
    setBusy(true);
    const current = generation.current;
    try {
      if (demo) {
        const existing = id
          ? (
              ledger[table] as unknown as Array<Record<string, unknown>>
            ).find((v) => v.id === id)
          : undefined;
        const next: Record<string, unknown> = {
          ...(existing ?? {}),
          ...value,
          id: id ?? demoId(),
        };
        if (table === "transactions") {
          if (options?.receiptFile) {
            next.receipt = URL.createObjectURL(options.receiptFile);
          } else if (options?.removeReceipt) {
            delete next.receipt;
          }
        }
        setLedger(
          (l) =>
            ({
              ...l,
              [table]: id
                ? l[table].map((v) => (v.id === id ? next : v))
                : [...l[table], next],
            }) as Ledger,
        );
      } else if (table === "transactions") {
        if (!backend || !session) throw new Error("Please sign in.");
        const api = backend;
        const stillOwner = ownerGuard();
        const payee = String(value.payee ?? "").trim();
        const original = id
          ? ledger.transactions.find((t) => t.id === id)
          : undefined;
        const receiptFile = options?.receiptFile ?? null;
        const removeReceipt = Boolean(options?.removeReceipt);
        queue.enqueue({
          label: `${id ? "Update" : "Add"} transaction${payee ? ` · ${payee.slice(0, 40)}` : ""}`,
          run: async () => {
            checkOwner(stillOwner);
            const latest = id ? latestTransaction(id) : undefined;
            const body =
              original && latest
                ? rebaseEdit<Record<string, unknown>>(
                    { ...original },
                    { ...original, ...value },
                    { ...latest },
                  )
                : { ...value };
            delete body.id;
            const record = await api.saveTransactionWithReceipt(
              body,
              id,
              receiptFile,
              removeReceipt,
            );
            if (stillOwner()) mergeRecords("transactions", [record]);
          },
        });
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const record = await backend.save(table, value, id);
        if (current !== generation.current) return;
        setLedger(
          (l) =>
            ({
              ...l,
              [table]: id
                ? l[table].map((v) => (v.id === id ? record : v))
                : [...l[table], record],
            }) as Ledger,
        );
      }
      setModal(null);
    } finally {
      setBusy(false);
    }
  }
  async function saveRule(
    value: Omit<TransactionRule, "id">,
    id?: string,
  ) {
    if (!demo && !online) {
      throw new Error("You're offline. Reconnect to save rules.");
    }
    if (busy) throw new Error("Another operation is running.");
    validateRule({ ...value, id }, ledger.categories);
    setBusy(true);
    const current = generation.current;
    try {
      let record: TransactionRule;
      if (demo) {
        record = { ...value, id: id ?? demoId() };
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        record = await backend.save("rules", { ...value }, id);
        if (current !== generation.current) return;
      }
      setLedger((l) => ({
        ...l,
        rules: id
          ? (l.rules ?? []).map((r) => (r.id === id ? record : r))
          : [...(l.rules ?? []), record],
      }));
    } finally {
      setBusy(false);
    }
  }
  async function deleteRule(id: string) {
    if (!demo && !online) {
      throw new Error("You're offline. Reconnect to delete rules.");
    }
    if (busy) return;
    setBusy(true);
    const current = generation.current;
    try {
      if (!demo) {
        if (!backend || !session) throw new Error("Please sign in.");
        await backend.remove("rules", id);
        if (current !== generation.current) return;
      }
      setLedger((l) => ({
        ...l,
        rules: (l.rules ?? []).filter((r) => r.id !== id),
      }));
    } finally {
      setBusy(false);
    }
  }
  async function importCapturedAlert(
    alert: CapturedAlert,
    tx: ImportTransaction,
  ) {
    if (!demo && !online) {
      throw new Error("You're offline. Reconnect to import alerts.");
    }
    if (demo) {
      const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setLedger((l) => ({
        ...l,
        transactions: [
          ...l.transactions,
          { ...tx, id, to_account_id: tx.to_account_id ?? null },
        ],
        captured_alerts: (l.captured_alerts ?? []).map((a) =>
          a.id === alert.id ? { ...a, status: "imported" } : a,
        ),
      }));
      return;
    }
    if (!backend || !session) throw new Error("Please sign in.");
    const savedTx = await backend.save("transactions", {
      ...tx,
      to_account_id: tx.to_account_id ?? "",
      category_id: tx.category_id ?? "",
    });
    await backend.updateCapturedAlertStatus(alert.id, "imported");
    setLedger((l) => ({
      ...l,
      transactions: [...l.transactions, savedTx],
      captured_alerts: (l.captured_alerts ?? []).map((a) =>
        a.id === alert.id ? { ...a, status: "imported" } : a,
      ),
    }));
  }
  async function dismissCapturedAlert(alertId: string) {
    if (!demo && !online) {
      throw new Error("You're offline. Reconnect to dismiss alerts.");
    }
    if (!demo) {
      if (!backend || !session) throw new Error("Please sign in.");
      await backend.updateCapturedAlertStatus(alertId, "dismissed");
    }
    setLedger((l) => ({
      ...l,
      captured_alerts: (l.captured_alerts ?? []).map((a) =>
        a.id === alertId ? { ...a, status: "dismissed" } : a,
      ),
    }));
  }
  async function addCapturedAlert(draft: Omit<CapturedAlert, "id">) {
    if (demo) {
      const id = `demo-alert-${Date.now()}`;
      setLedger((l) => ({
        ...l,
        captured_alerts: [{ ...draft, id }, ...(l.captured_alerts ?? [])],
      }));
      return;
    }
    if (!online) throw new Error("You're offline. Reconnect to save alerts.");
    if (!backend || !session) throw new Error("Please sign in.");
    const saved = await backend.createCapturedAlert(draft);
    setLedger((l) => ({
      ...l,
      captured_alerts: [saved, ...(l.captured_alerts ?? [])],
    }));
  }
  async function categorize(t: Transaction, categoryId: string) {
    setError("");
    try {
      const { id, ...value } = t;
      const next = { ...value, category_id: categoryId };
      validateTransaction({ ...next, id }, ledger);
      await save("transactions", next, id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function saveGoal(value: GoalDraft, id?: string) {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        const record: SavingsGoal = { ...value, id: id ?? demoId() };
        setLedger((l) => ({
          ...l,
          goals: id
            ? (l.goals ?? []).map((g) => (g.id === id ? record : g))
            : [...(l.goals ?? []), record],
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        const record = await backend.save("goals", value, id);
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          goals: id
            ? (l.goals ?? []).map((g) => (g.id === id ? record : g))
            : [...(l.goals ?? []), record],
        }));
      }
      setGoalModal(null);
    } finally {
      setBusy(false);
    }
  }
  async function deleteGoal(goal: SavingsGoal) {
    setBusy(true);
    setError("");
    try {
      if (!demo) {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        await backend.remove("goals", goal.id);
        if (current !== generation.current) return;
      }
      setLedger((l) => ({
        ...l,
        goals: (l.goals ?? []).filter((g) => g.id !== goal.id),
        goal_contributions: (l.goal_contributions ?? []).filter(
          (c) => c.goal_id !== goal.id,
        ),
      }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function contributeToGoal(payload: {
    goal: SavingsGoal;
    amount: number;
    date: string;
    notes: string;
    recordTransaction?: Omit<Transaction, "id">;
  }) {
    setBusy(true);
    setError("");
    try {
      const { goal, amount, date, notes, recordTransaction } = payload;
      const nextAmount = applyContributionAmount(goal.current_amount, amount);
      const nextStatus =
        nextAmount >= goal.target_amount && goal.status === "active"
          ? "completed"
          : goal.status;

      if (demo) {
        let txId: string | null = null;
        let createdTx: Transaction | null = null;
        if (recordTransaction) {
          txId = demoId();
          createdTx = { ...recordTransaction, id: txId };
        }
        const contrib: GoalContribution = {
          id: demoId(),
          goal_id: goal.id,
          amount,
          date,
          transaction_id: txId,
          notes,
        };
        const updatedGoal: SavingsGoal = {
          ...goal,
          current_amount: nextAmount,
          status: nextStatus,
        };
        setLedger((l) => ({
          ...l,
          transactions: createdTx
            ? [...l.transactions, createdTx]
            : l.transactions,
          goals: (l.goals ?? []).map((g) =>
            g.id === goal.id ? updatedGoal : g,
          ),
          goal_contributions: [...(l.goal_contributions ?? []), contrib],
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        let createdTx: Transaction | null = null;
        if (recordTransaction) {
          createdTx = await backend.save("transactions", recordTransaction);
        }
        const contrib = await backend.save("goal_contributions", {
          goal_id: goal.id,
          amount,
          date,
          transaction_id: createdTx ? createdTx.id : "",
          notes,
        });
        const updatedGoal = await backend.save(
          "goals",
          { current_amount: nextAmount, status: nextStatus },
          goal.id,
        );
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          transactions: createdTx
            ? [...l.transactions, createdTx]
            : l.transactions,
          goals: (l.goals ?? []).map((g) =>
            g.id === goal.id ? updatedGoal : g,
          ),
          goal_contributions: [...(l.goal_contributions ?? []), contrib],
        }));
      }
      setGoalContributeTarget(null);
    } finally {
      setBusy(false);
    }
  }
  async function deleteGoalContribution(c: GoalContribution) {
    setBusy(true);
    setError("");
    try {
      const goal = (ledgerRef.current.goals ?? []).find(
        (g) => g.id === c.goal_id,
      );
      const nextAmount = goal
        ? applyContributionAmount(goal.current_amount, -c.amount)
        : null;
      if (!demo) {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        await backend.remove("goal_contributions", c.id);
        if (goal && nextAmount !== null) {
          await backend.save("goals", { current_amount: nextAmount }, goal.id);
        }
        if (current !== generation.current) return;
      }
      setLedger((l) => ({
        ...l,
        goal_contributions: (l.goal_contributions ?? []).filter(
          (item) => item.id !== c.id,
        ),
        goals:
          goal && nextAmount !== null
            ? (l.goals ?? []).map((g) =>
                g.id === goal.id ? { ...g, current_amount: nextAmount } : g,
              )
            : l.goals,
      }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveNetWorthItem(draft: NetWorthItemDraft, id?: string) {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        const saved: NetWorthItem = { ...draft, id: id ?? demoId() };
        const initialSnap: NetWorthSnapshot | null = id
          ? null
          : {
              id: demoId(),
              item_id: saved.id,
              value: saved.current_value,
              date: saved.as_of_date,
              notes: "Initial valuation",
            };
        setLedger((l) => ({
          ...l,
          net_worth_items: id
            ? (l.net_worth_items ?? []).map((i) => (i.id === id ? saved : i))
            : [...(l.net_worth_items ?? []), saved],
          net_worth_snapshots: initialSnap
            ? [...(l.net_worth_snapshots ?? []), initialSnap]
            : l.net_worth_snapshots,
        }));
        setNetWorthModal(null);
        return;
      }
      if (!backend || !session) throw new Error("Please sign in.");
      const current = generation.current;
      const saved = await backend.save("net_worth_items", draft, id);
      let initialSnap: NetWorthSnapshot | null = null;
      if (!id) {
        initialSnap = await backend.save("net_worth_snapshots", {
          item_id: saved.id,
          value: saved.current_value,
          date: saved.as_of_date,
          notes: "Initial valuation",
        });
      }
      if (current !== generation.current) return;
      setLedger((l) => ({
        ...l,
        net_worth_items: id
          ? (l.net_worth_items ?? []).map((i) => (i.id === id ? saved : i))
          : [...(l.net_worth_items ?? []), saved],
        net_worth_snapshots: initialSnap
          ? [...(l.net_worth_snapshots ?? []), initialSnap]
          : l.net_worth_snapshots,
      }));
      setNetWorthModal(null);
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function deleteNetWorthItem(item: NetWorthItem) {
    setBusy(true);
    setError("");
    try {
      if (!demo) {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        await backend.remove("net_worth_items", item.id);
        if (current !== generation.current) return;
      }
      setLedger((l) => ({
        ...l,
        net_worth_items: (l.net_worth_items ?? []).filter(
          (i) => i.id !== item.id,
        ),
        net_worth_snapshots: (l.net_worth_snapshots ?? []).filter(
          (s) => s.item_id !== item.id,
        ),
      }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function updateNetWorthValuation(
    item: NetWorthItem,
    value: number,
    date: string,
    notes: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const nextAsOf = date >= item.as_of_date ? date : item.as_of_date;
      const nextVal = date >= item.as_of_date ? value : item.current_value;
      if (demo) {
        const snap: NetWorthSnapshot = {
          id: demoId(),
          item_id: item.id,
          value,
          date,
          notes,
        };
        setLedger((l) => ({
          ...l,
          net_worth_snapshots: [...(l.net_worth_snapshots ?? []), snap],
          net_worth_items: (l.net_worth_items ?? []).map((i) =>
            i.id === item.id
              ? { ...i, current_value: nextVal, as_of_date: nextAsOf }
              : i,
          ),
        }));
        setNetWorthValuationTarget(null);
        return;
      }
      if (!backend || !session) throw new Error("Please sign in.");
      const current = generation.current;
      const snap = await backend.save("net_worth_snapshots", {
        item_id: item.id,
        value,
        date,
        notes,
      });
      const updated = await backend.save(
        "net_worth_items",
        { current_value: nextVal, as_of_date: nextAsOf },
        item.id,
      );
      if (current !== generation.current) return;
      setLedger((l) => ({
        ...l,
        net_worth_snapshots: [...(l.net_worth_snapshots ?? []), snap],
        net_worth_items: (l.net_worth_items ?? []).map((i) =>
          i.id === item.id ? updated : i,
        ),
      }));
      setNetWorthValuationTarget(null);
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function deleteNetWorthSnapshot(snap: NetWorthSnapshot) {
    setBusy(true);
    setError("");
    try {
      if (!demo) {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        await backend.remove("net_worth_snapshots", snap.id);
        if (current !== generation.current) return;
      }
      setLedger((l) => ({
        ...l,
        net_worth_snapshots: (l.net_worth_snapshots ?? []).filter(
          (s) => s.id !== snap.id,
        ),
      }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function restoreBackup(backup: FuloosBackup, mode: RestoreMode) {
    const { presets: existingPresets } = await presetStore.load();
    if (demo) {
      const { ledger: nextLedger } = await executeRestore({
        backup,
        mode,
        existingLedger: ledgerRef.current,
        existingPresets,
        presetStore,
        demo: true,
        demoId,
      });
      setLedger(nextLedger);
      return;
    }
    if (!backend || !session) throw new Error("Please sign in.");
    const api = backend;
    const stillOwner = ownerGuard();
    const total =
      backup.data.accounts.length +
      backup.data.categories.length +
      backup.data.transactions.length +
      backup.data.recurring.length +
      backup.data.recurring_occurrences.length +
      backup.data.budgets.length +
      backup.data.csv_presets.length +
      1;
    queue.enqueue({
      label: `Restore backup (${backup.data.transactions.length} transactions)`,
      total,
      run: async (ctx) => {
        checkOwner(stillOwner);
        try {
          const { ledger: nextLedger } = await executeRestore({
            backup,
            mode,
            existingLedger: ledgerRef.current,
            existingPresets,
            presetStore,
            backend: api,
            demo: false,
            demoId,
            shouldContinue: stillOwner,
            onProgress: (done) => ctx.progress(done),
          });
          if (stillOwner()) setLedger(nextLedger);
        } catch (e) {
          if (stillOwner()) await load();
          throw e;
        }
      },
    });
  }
  const {
    recurringModal,
    setRecurringModal,
    confirmOcc,
    setConfirmOcc,
    recurringTab,
    setRecurringTab,
    recurringFilter,
    setRecurringFilter,
    saveRecurring,
    savePreferences,
    acceptDetectedPattern,
    editDetectedPattern,
    dismissPattern,
    dismissMatchCandidate,
    restoreDismissed,
    runAutoReconciliation,
    togglePauseRecurring,
    confirmCreateOccurrence,
    confirmLinkOccurrence,
    unlinkOccurrence,
  } = useRecurringActions({
    demo,
    session,
    ledger,
    setLedger,
    busy,
    setBusy,
    setError,
    generation,
    demoId,
  });
  const { bulkUpdate, importTransactions, createCategories } = useImportAndBulk({
    demo,
    session,
    queue,
    ledger,
    setLedger,
    ledgerRef,
    busy,
    setBusy,
    generation,
    demoId,
    ownerGuard,
    checkOwner,
    load,
    latestTransaction,
    mergeRecords,
    updateTransactions,
  });
  async function saveBudget(value: BudgetDraft, id?: string) {
    if (busy) return;
    validateBudget({ ...value, id }, ledger);
    setBusy(true);
    const current = generation.current;
    try {
      let record: Budget;
      if (demo) record = { ...value, id: id ?? demoId() };
      else {
        if (!backend || !session) throw new Error("Please sign in.");
        record = await backend.save("budgets", { ...value }, id);
        if (current !== generation.current) return;
      }
      setLedger((l) => ({
        ...l,
        budgets: id
          ? (l.budgets ?? []).map((b) => (b.id === id ? record : b))
          : [...(l.budgets ?? []), record],
      }));
      setBudgetModal(null);
    } finally {
      setBusy(false);
    }
  }
  /**
   * Deletes a money account with its recurring schedules and every transaction touching it.
   * The account leaves the screen at once and the server work runs in the background queue,
   * so its progress shows in the corner panel instead of inside the dialog.
   */
  const {
    accountToDelete,
    setAccountToDelete,
    categoriesToDelete,
    setCategoriesToDelete,
    transactionsToDelete,
    setTransactionsToDelete,
    deleteMoneyAccount,
    deleteCategories,
    deleteTransactions,
  } = useDeletionActions({
    demo,
    session,
    queue,
    ledger,
    setLedger,
    ledgerRef,
    savedTx,
    ownerGuard,
    checkOwner,
    load,
    setError,
    setSelected,
    setSelectedCategories,
    accountFilter,
    setAccountFilter,
    updateTransactions,
  });
  async function remove(
    table: "categories" | "transactions" | "recurring" | "budgets",
    id: string,
  ) {
    if (busy) return;
    const noun =
      table === "categories"
        ? "category"
        : table === "transactions"
          ? "transaction"
          : table === "recurring"
            ? "recurring schedule"
            : "budget";
    const message =
      table === "recurring"
        ? "Past recorded transactions will stay in your ledger."
        : table === "budgets"
          ? "Your transactions are not affected."
          : table === "categories" &&
              (ledger.budgets ?? []).some((b) => b.category_id === id)
            ? "Its budgets will be removed too. This cannot be undone."
            : "This cannot be undone.";
    const ok = await confirmDialog({
      title: `Delete this ${noun}?`,
      message,
      confirmLabel: `Delete ${noun}`,
      tone: "danger",
    });
    if (!ok || busy) return;
    const currentLedger = ledgerRef.current;
    setBusy(true);
    setError("");
    try {
      if (table === "categories") {
        if (currentLedger.transactions.some((t) => t.category_id === id))
          throw new Error("Reassign this category’s transactions first.");
        if ((currentLedger.recurring ?? []).some((r) => r.category_id === id))
          throw new Error(
            "Reassign this category’s recurring schedules first.",
          );
      }
      const applyRemoval = (l: Ledger): Ledger => {
        if (table === "recurring") {
          return {
            ...l,
            recurring: (l.recurring ?? []).filter((r) => r.id !== id),
            recurring_occurrences: (l.recurring_occurrences ?? []).filter(
              (o) => o.recurring_id !== id,
            ),
          };
        }
        if (table === "budgets") {
          return {
            ...l,
            budgets: (l.budgets ?? []).filter((b) => b.id !== id),
          };
        }
        if (table === "categories") {
          return {
            ...l,
            categories: l.categories.filter((c) => c.id !== id),
            budgets: (l.budgets ?? []).filter((b) => b.category_id !== id),
          };
        }
        if (table === "transactions") {
          return {
            ...l,
            transactions: l.transactions.filter((t) => t.id !== id),
            recurring_occurrences: (l.recurring_occurrences ?? []).filter(
              (o) => o.transaction_id !== id,
            ),
          };
        }
        return l;
      };
      if (demo) setLedger(applyRemoval);
      else {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        await backend.remove(table, id);
        if (table === "transactions") savedTx.current.delete(id);
        if (current !== generation.current) return;
        setLedger(applyRemoval);
        setSelected((old) => new Set([...old].filter((value) => value !== id)));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const start = new Date(`${month}-01T00:00:00Z`);
  const span = isPeriodSpan(view) ? view : "month";
  const firstMonth = periodMonths(span, month, rangeFrom)?.first ?? month;
  start.setTime(Date.parse(`${firstMonth}-01T00:00:00Z`));
  const rangeLabel = periodLabel(span, month, rangeFrom);
  const activeMonths = useMemo(
    () => new Set(ledger.transactions.map((t) => t.date.slice(0, 7))),
    [ledger.transactions],
  );
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);
  const monthly = useMemo(
    () =>
      view === "all"
        ? ledger.transactions
        : ledger.transactions.filter(
            (t) => t.date >= startIso && t.date < endIso,
          ),
    [ledger.transactions, view, startIso, endIso],
  );
  const summary = useMemo(() => totals(monthly), [monthly]);
  const net = useMemo(
    () =>
      ledger.accounts.reduce(
        (s, a) => s + balance(a, ledger.transactions),
        0,
      ),
    [ledger.accounts, ledger.transactions],
  );
  const balanceNote = (a: Account, short = false) =>
    hasBalanceAnchor(a)
      ? `${concealed(a.opening_balance)}${short ? " · " : " at end of "}${new Date(
          balanceAsOfDate(a) + "T12:00:00Z",
        ).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`
      : "Sum of transactions";
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of ledger.transactions) {
      const seen = new Set<string>();
      for (const part of transactionCategoryAmounts(t)) {
        if (part.category_id && !seen.has(part.category_id)) {
          seen.add(part.category_id);
          counts.set(part.category_id, (counts.get(part.category_id) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [ledger.transactions]);
  const spending = useMemo<SpendingItem[]>(() => {
    const byCategory = new Map<string, number>();
    let uncategorized = 0;
    for (const t of monthly) {
      if (t.type !== "expense") continue;
      for (const part of transactionCategoryAmounts(t)) {
        if (part.category_id) {
          byCategory.set(
            part.category_id,
            (byCategory.get(part.category_id) ?? 0) + part.amount,
          );
        } else {
          uncategorized += part.amount;
        }
      }
    }
    const items: SpendingItem[] = [];
    for (const c of ledger.categories) {
      const total = byCategory.get(c.id) ?? 0;
      if (total > 0) items.push({ ...c, total });
    }
    items.sort((a, b) => b.total - a.total);
    if (uncategorized > 0) {
      items.push({
        id: "uncategorized",
        name: "Uncategorized",
        description: "",
        color: "#929b96",
        total: uncategorized,
      });
    }
    return items;
  }, [monthly, ledger.categories]);
  const concealed = (v: number) => (hidden ? "••••••" : money(v));
  const budgetRangeStart =
    view === "all"
      ? (ledger.budgets ?? []).reduce(
          (first, b) => (b.start_month < first ? b.start_month : first),
          month,
        )
      : start.toISOString().slice(0, 7);
  if (checking) return <div className="loading">Opening Fuloos…</div>;
  if (!session && !demo)
    return <Auth onDemo={startDemo} externalError={error} />;
  if (session && !demo && locked && lockConfig)
    return (
      <AppLockScreen
        email={session.user.email}
        config={lockConfig}
        storage={appStorage}
        onUnlock={() => {
          lastActiveRef.current = Date.now();
          setLocked(false);
        }}
        onSignOut={() => {
          setLocked(false);
          backend?.signOut();
        }}
        onLockout={() => {
          clearAppLock(appStorage, session.user.id);
          setLocked(false);
          setError("Signed out after too many incorrect PIN attempts.");
          backend?.signOut();
        }}
      />
    );
  return (
    <div className="shell">
      <Sidebar
        page={page}
        demo={demo}
        session={session}
        onNavigate={(name) => {
          setPage(name);
          setSearch("");
          setAccountFilter("");
          setKindFilter("");
          if (name === "Recurring") {
            setRecurringFilter("all");
            setRecurringTab("schedules");
          }
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onSignOutDemo={(empty) => {
          setDemo(false);
          setLedger(empty);
        }}
      />
      <main>
        <AppTopbar
          page={page}
          demo={demo}
          session={session}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="content">
          <PwaBanners
            online={online}
            demo={demo}
            updateAvailable={Boolean(swUpdate)}
            onApplyUpdate={() => swUpdate?.()}
            canInstall={canInstall}
            onInstall={() => void promptInstall()}
          />
          <AppPageHeader
            page={page}
            demo={demo}
            loading={loading}
            busy={busy}
            error={error}
            month={month}
            rangeFrom={rangeFrom}
            span={span}
            activeMonths={activeMonths}
            onExitDemo={() => {
              setDemo(false);
              setLedger(emptyLedger);
            }}
            onPrimaryAction={() => {
              if (page === "Recurring") {
                setRecurringModal({ open: true });
              } else if (page === "Budgets") {
                setBudgetModal({ draft: { start_month: month } });
              } else if (page === "Goals") {
                setGoalModal({ open: true });
              } else if (page === "Net Worth") {
                setNetWorthModal({ open: true });
              } else {
                setModal({
                  kind:
                    page === "Accounts"
                      ? "account"
                      : page === "Categories"
                        ? "category"
                        : "transaction",
                });
              }
            }}
            onRetry={() => void load()}
            onPeriodChange={(next) => {
              setView(next.span);
              setMonth(next.month);
              if (next.from) setRangeFrom(next.from);
            }}
          />
          {!demo && (
            <SchemaBanner
              status={schemaStatus}
              dismissed={schemaDismissed}
              onDismiss={() => setSchemaDismissed(true)}
            />
          )}
          {page === "Overview" && (
            <OverviewPage
              ledger={ledger}
              net={net}
              summary={summary}
              rangeLabel={rangeLabel}
              hidden={hidden}
              setHidden={setHidden}
              concealed={concealed}
              spending={spending}
              monthly={monthly}
              month={month}
              busy={busy}
              onNavigate={setPage}
              onSelectAccount={setAccountFilter}
              onOpenModal={setModal}
              onOpenRecurring={(tab = "schedules", filter = "all") => {
                setRecurringTab(tab);
                setRecurringFilter(filter);
                setPage("Recurring");
              }}
              onConfirmOccurrence={(schedule, occurrenceDate) =>
                setConfirmOcc({ schedule, occurrenceDate })
              }
              onAddGoal={() => setGoalModal({ open: true })}
              onContributeGoal={(goal) => setGoalContributeTarget(goal)}
            />
          )}
          {page === "Recurring" && (
            <Suspense fallback={<div className="loading-inline">Loading…</div>}>
              <RecurringPage
                ledger={ledger}
                concealed={concealed}
                busy={busy}
                initialTab={recurringTab}
                initialFilter={recurringFilter}
                onAddSchedule={() => setRecurringModal({ open: true })}
                onEditSchedule={(item) => setRecurringModal({ open: true, item })}
                onTogglePause={(item) => void togglePauseRecurring(item)}
                onDeleteSchedule={(item) => void remove("recurring", item.id)}
                onConfirmOccurrence={(schedule, occurrenceDate) =>
                  setConfirmOcc({ schedule, occurrenceDate })
                }
                onUnlinkOccurrence={(occurrenceId) =>
                  void unlinkOccurrence(occurrenceId)
                }
                onRelinkOccurrence={(existing, schedule, occurrenceDate) =>
                  setConfirmOcc({
                    schedule,
                    occurrenceDate,
                    existingConfirmation: existing,
                  })
                }
                onAcceptPattern={(pattern) => void acceptDetectedPattern(pattern)}
                onEditPattern={(pattern) => editDetectedPattern(pattern)}
                onDismissPattern={(patternKey) => void dismissPattern(patternKey)}
                onConfirmMatchCandidate={(candidate) =>
                  void confirmLinkOccurrence(
                    candidate.schedule,
                    candidate.occurrenceDate,
                    candidate.transaction.id,
                    undefined,
                    "manual",
                    candidate.summaryReason,
                  )
                }
                onDismissMatchCandidate={(matchKey) =>
                  void dismissMatchCandidate(matchKey)
                }
                onUpdatePreferences={(prefs) => void savePreferences(prefs)}
                onRestoreDismissed={() => void restoreDismissed()}
                onRunReconciliation={() => void runAutoReconciliation()}
              />
            </Suspense>
          )}
          {page === "Budgets" && (
            <Suspense fallback={<div className="loading-inline">Loading…</div>}>
              <BudgetsPage
                ledger={ledger}
                month={month}
                onMonthChange={(next) => {
                  // Keep a custom range's length when Budgets moves the shared month.
                  if (span === "custom")
                    setRangeFrom((from) =>
                      shiftMonth(from, monthsBetween(month, next) - 1),
                    );
                  setMonth(next);
                }}
                concealed={concealed}
                busy={busy}
                onAdd={(draft) => setBudgetModal({ draft })}
                onEdit={(item) => setBudgetModal({ item })}
                onDelete={(item) => void remove("budgets", item.id)}
              />
            </Suspense>
          )}
          {page === "Goals" && (
            <Suspense fallback={<div className="loading-inline">Loading…</div>}>
              <GoalsPage
                ledger={ledger}
                concealed={concealed}
                busy={busy}
                onAddGoal={() => setGoalModal({ open: true })}
                onEditGoal={(item) => setGoalModal({ open: true, item })}
                onDeleteGoal={deleteGoal}
                onContributeGoal={(goal) => setGoalContributeTarget(goal)}
                onDeleteContribution={deleteGoalContribution}
              />
            </Suspense>
          )}
          {page === "Reports" && (
            <Suspense fallback={<div className="loading-inline">Loading…</div>}>
              <ReportsPage
                ledger={ledger}
                budgetRangeStart={budgetRangeStart}
                month={month}
                view={view}
                rangeLabel={rangeLabel}
                summary={summary}
                spending={spending}
                concealed={concealed}
                onManageBudgets={() => setPage("Budgets")}
              />
            </Suspense>
          )}
          {page === "Accounts" && (
            <AccountsPage
              ledger={ledger}
              net={net}
              density={density}
              busy={busy}
              concealed={concealed}
              balanceNote={balanceNote}
              onSelectAccount={(accountId) => {
                setPage("Transactions");
                setAccountFilter(accountId);
              }}
              onOpenModal={setModal}
              onDeleteAccount={setAccountToDelete}
            />
          )}
          {page === "Categories" && (
            <CategoriesPage
              ledger={ledger}
              density={density}
              busy={busy}
              categoryCounts={categoryCounts}
              selectedCategories={selectedCategories}
              setSelectedCategories={setSelectedCategories}
              toggleCategory={toggleCategory}
              onDeleteCategories={setCategoriesToDelete}
              onOpenModal={setModal}
              onOpenRules={() => setRulesOpen(true)}
            />
          )}
          {page === "Transactions" && (
            <TransactionsPanel
              ledger={ledger}
              from={
                view === "all" ? undefined : start.toISOString().slice(0, 10)
              }
              to={view === "all" ? undefined : end.toISOString().slice(0, 10)}
              hidden={hidden}
              busy={busy}
              loading={loading}
              search={search}
              onSearch={setSearch}
              accountFilter={accountFilter}
              onAccountFilter={setAccountFilter}
              kindFilter={kindFilter}
              onKindFilter={setKindFilter}
              selected={selected}
              onSelectionChange={setSelected}
              onImport={() => setImportOpen(true)}
              onImportSms={() => setSmsOpen(true)}
              onImportPdf={() => setPdfOpen(true)}
              pendingAlertCount={
                pendingCapturedAlerts(ledger.captured_alerts).length
              }
              onOpenCaptureAlerts={() => setCaptureAlertsOpen(true)}
              onEditSelected={setBulkItems}
              onDeleteSelected={(items) =>
                setTransactionsToDelete(items.map((t) => t.id))
              }
              onEdit={(t) => setModal({ kind: "transaction", item: t })}
              onDelete={(t) => void remove("transactions", t.id)}
              onCategorize={(t, categoryId) => void categorize(t, categoryId)}
            />
          )}
          <footer>
            <Leaf size={14} />
            <span>{t("footer.tagline")}</span>
            <span className="footer-brand">{t("footer.brand")}</span>
          </footer>
        </div>
      </main>
      <QueueDock queue={queue} />
      <AppModals
        demo={demo}
        session={session}
        ledger={ledger}
        setLedger={setLedger}
        busy={busy}
        hidden={hidden}
        concealed={concealed}
        load={load}
        save={save}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        deleteOpen={deleteOpen}
        setDeleteOpen={setDeleteOpen}
        accountToDelete={accountToDelete}
        setAccountToDelete={setAccountToDelete}
        deleteMoneyAccount={deleteMoneyAccount}
        categoriesToDelete={categoriesToDelete}
        setCategoriesToDelete={setCategoriesToDelete}
        deleteCategories={deleteCategories}
        transactionsToDelete={transactionsToDelete}
        setTransactionsToDelete={setTransactionsToDelete}
        deleteTransactions={deleteTransactions}
        bulkItems={bulkItems}
        setBulkItems={setBulkItems}
        bulkUpdate={bulkUpdate}
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        smsOpen={smsOpen}
        setSmsOpen={setSmsOpen}
        pdfOpen={pdfOpen}
        setPdfOpen={setPdfOpen}
        captureAlertsOpen={captureAlertsOpen}
        setCaptureAlertsOpen={setCaptureAlertsOpen}
        pendingAlertCount={pendingCapturedAlerts(ledger.captured_alerts).length}
        onImportCapturedAlert={importCapturedAlert}
        onDismissCapturedAlert={dismissCapturedAlert}
        onAddCapturedAlert={addCapturedAlert}
        importTransactions={importTransactions}
        createCategories={createCategories}
        presetStore={presetStore}
        learningStore={learningStore}
        recurringModal={recurringModal}
        setRecurringModal={setRecurringModal}
        saveRecurring={saveRecurring}
        unlinkOccurrence={unlinkOccurrence}
        budgetModal={budgetModal}
        setBudgetModal={setBudgetModal}
        saveBudget={saveBudget}
        confirmOcc={confirmOcc}
        setConfirmOcc={setConfirmOcc}
        confirmCreateOccurrence={confirmCreateOccurrence}
        confirmLinkOccurrence={confirmLinkOccurrence}
        modal={modal}
        setModal={setModal}
        rulesOpen={rulesOpen}
        setRulesOpen={setRulesOpen}
        saveRule={saveRule}
        deleteRule={deleteRule}
        restoreBackup={restoreBackup}
        security={
          !demo && session ? (
            <SecuritySettings
              session={session}
              storage={appStorage}
              onLockNow={() => setLocked(true)}
              onLockConfigChanged={setLockConfig}
              onIdleTimeoutChanged={setIdleSignOutMinutes}
              onCloseSettings={() => setSettingsOpen(false)}
            />
          ) : undefined
        }
      />
      {goalModal && (
        <GoalEditorModal
          ledger={ledger}
          item={goalModal.item}
          busy={busy}
          onClose={() => {
            if (!busy) setGoalModal(null);
          }}
          onSave={saveGoal}
        />
      )}
      {goalContributeTarget && (
        <GoalContributeModal
          ledger={ledger}
          goal={goalContributeTarget}
          busy={busy}
          onClose={() => {
            if (!busy) setGoalContributeTarget(null);
          }}
          onSubmit={contributeToGoal}
        />
      )}
      {netWorthModal && (
        <NetWorthItemEditorModal
          item={netWorthModal.item}
          busy={busy}
          onClose={() => {
            if (!busy) setNetWorthModal(null);
          }}
          onSave={saveNetWorthItem}
        />
      )}
      {netWorthValuationTarget && (
        <NetWorthValuationModal
          item={netWorthValuationTarget}
          busy={busy}
          onClose={() => {
            if (!busy) setNetWorthValuationTarget(null);
          }}
          onSave={updateNetWorthValuation}
        />
      )}
      <QuickAddFab disabled={busy} onClick={() => setQuickAdd({})} />
      {quickAdd && (
        <QuickAddModal
          ledger={ledger}
          initialDraft={quickAdd}
          busy={busy}
          online={online}
          demo={demo}
          onClose={() => setQuickAdd(null)}
          onSave={save}
          onAddAccount={() => setModal({ kind: "account" })}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
      <ConfirmHost />
    </LocaleProvider>
  </React.StrictMode>,
);
