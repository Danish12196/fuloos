import { BulkEdit } from "./BulkEdit";
import { ColorPicker, EmojiField } from "./Appearance";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  backend,
  createLearningStore,
  createPresetStore,
  type Session,
} from "./client";
import { DeleteAccountDialog } from "./DeleteAccount";
import { ConfirmHost } from "./ConfirmHost";
import { confirmDialog } from "./dialogStore";
import { DeleteMoneyAccountDialog } from "./DeleteMoneyAccount";
import { applyAccountDeletion, planAccountDeletion } from "./accountDeletion";
import { DeleteCategoriesDialog } from "./DeleteCategories";
import {
  applyCategoryDeletion,
  movedTransactions,
  planCategoryDeletion,
  validateMoveTarget,
} from "./categoryDeletion";
import { CsvImport } from "./CsvImport";
import { SmsImport } from "./SmsImport";
import { QueueDock, useLeaveWarning, useQueue } from "./QueueDock";
import { TaskQueue } from "./taskQueue";
import { rebaseEdit } from "./bulk";
import {
  BudgetEditorModal,
  BudgetReportPanel,
  BudgetsPage,
  monthLabel,
  type BudgetDraft,
} from "./BudgetsView";
import { validateBudget } from "./budgets";
import type { ImportTransaction } from "./csv";
import {
  ConfirmOccurrenceModal,
  DashboardRecurring,
  RecurringEditorModal,
  RecurringPage,
  type RecurringTab,
} from "./RecurringView";
import {
  buildMatchDismissKey,
  reconcileTransactions,
  type DetectedPattern,
  type MatchCandidate,
} from "./recurringAutomation";
import {
  validateOccurrenceConfirmation,
  validateRecurringSchedule,
} from "./recurring";
import { ThemeToggle } from "./ThemeToggle";
import { TransactionsPanel } from "./TransactionTable";
import { SettingsDialog } from "./Settings";
import { useDensity } from "./density";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Settings as SettingsIcon,
  ArrowLeftRight,
  Plus,
  LayoutDashboard,
  Wallet,
  Tags,
  ReceiptText,
  Repeat,
  LogOut,
  X,
  Search,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Leaf,
  Trash2,
  Pencil,
  Unlink,
  PiggyBank,
} from "lucide-react";
import {
  balance,
  balanceAsOfDate,
  emptyLedger,
  hasBalanceAnchor,
  isIsoCalendarDate,
  NO_BALANCE_DATE,
  openingDateFor,
  startingBalance,
  errorMessage,
  minor,
  money,
  shiftMonth,
  today,
  totals,
  validateTransaction,
  type Account,
  type AccountType,
  type Budget,
  type Category,
  type Kind,
  type Ledger,
  type OccurrenceMatchSource,
  type RecurringPreferences,
  type RecurringOccurrenceRecord,
  type RecurringSchedule,
  type Transaction,
  defaultRecurringPreferences,
} from "./domain";
import { demoLedger } from "./demo";
import "./style.css";
import { PeriodPicker } from "./PeriodPicker";
import {
  isPeriodSpan,
  monthsBetween,
  periodDates,
  periodLabel,
  periodMonths,
} from "./period";
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
    [deleteOpen, setDeleteOpen] = useState(false),
    [accountToDelete, setAccountToDelete] = useState<Account | null>(null),
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
  const [density] = useDensity();
  const [smsOpen, setSmsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [categoriesToDelete, setCategoriesToDelete] = useState<string[] | null>(
    null,
  );
  const [bulkItems, setBulkItems] = useState<Transaction[] | null>(null);
  const [recurringModal, setRecurringModal] = useState<{
    open: true;
    item?: RecurringSchedule;
    initialDraft?: Partial<Omit<RecurringSchedule, "id">>;
    historicalLinks?: { occurrence_date: string; transaction_id: string }[];
  } | null>(null);
  const [confirmOcc, setConfirmOcc] = useState<{
    schedule: RecurringSchedule;
    occurrenceDate: string;
    existingConfirmation?: RecurringOccurrenceRecord;
  } | null>(null);
  const [recurringTab, setRecurringTab] = useState<RecurringTab>("schedules");
  const [recurringFilter, setRecurringFilter] = useState<
    "all" | "active" | "overdue" | "paused"
  >("all");
  const [budgetModal, setBudgetModal] = useState<{
    item?: Budget;
    draft?: Partial<BudgetDraft>;
  } | null>(null);
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
    setBudgetModal(null);
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
  async function bulkUpdate(
    rows: Transaction[],
    progress: (records: Transaction[]) => void,
  ) {
    rows.forEach((t) => validateTransaction(t, ledger));
    if (demo) {
      updateTransactions(rows);
      progress(rows);
      return;
    }
    if (!backend || !session) throw new Error("Please sign in.");
    const api = backend;
    const stillOwner = ownerGuard();
    const originals = new Map(
      ledger.transactions.map((t) => [t.id, t] as const),
    );
    queue.enqueue({
      label: `Update ${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}`,
      total: rows.length,
      run: async (ctx) => {
        checkOwner(stillOwner);
        try {
          // Re-apply only the changed fields to the newest copy, so an
          // earlier queued edit to the same rows is not undone.
          const fresh = rows.map((row) => {
            const original = originals.get(row.id);
            const latest = latestTransaction(row.id);
            return original && latest ? rebaseEdit(original, row, latest) : row;
          });
          fresh.forEach((t) => validateTransaction(t, ledgerRef.current));
          await api.updateTransactions(
            fresh,
            (saved, records) => {
              if (!stillOwner()) return;
              updateTransactions(records);
              ctx.progress(saved);
            },
            stillOwner,
          );
        } catch (e) {
          if (stillOwner()) await load();
          throw e;
        }
      },
    });
  }
  useEffect(() => {
    if (!backend) return;
    backend
      .getSession()
      .then(setSession)
      .catch((e) => setError(errorMessage(e)))
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
      if (current === generation.current) {
        savedTx.current.clear();
        setLedger(data);
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
    const current = generation.current;
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
      } else if (table === "transactions") {
        if (!backend || !session) throw new Error("Please sign in.");
        const api = backend;
        const stillOwner = ownerGuard();
        const payee = String(value.payee ?? "").trim();
        const original = id
          ? ledger.transactions.find((t) => t.id === id)
          : undefined;
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
                : value;
            delete body.id;
            const record = await api.save("transactions", body, id);
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
  async function saveRecurring(
    value: Omit<RecurringSchedule, "id">,
    id?: string,
  ) {
    if (busy) throw new Error("Another operation is running.");
    validateRecurringSchedule({ ...value, id }, ledger);
    setBusy(true);
    const current = generation.current;
    try {
      let savedId = id;
      if (demo) {
        savedId = id ?? demoId();
        const next: RecurringSchedule = { ...value, id: savedId };
        const newOccs: RecurringOccurrenceRecord[] =
          !id && recurringModal?.historicalLinks?.length
            ? recurringModal.historicalLinks.map((link) => ({
                id: demoId(),
                recurring_id: savedId!,
                occurrence_date: link.occurrence_date,
                transaction_id: link.transaction_id,
                match_source: "auto",
                match_reason: "Linked from detected recurring pattern",
              }))
            : [];
        setLedger((l) => ({
          ...l,
          recurring: id
            ? (l.recurring ?? []).map((r) => (r.id === id ? next : r))
            : [...(l.recurring ?? []), next],
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...newOccs,
          ],
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const record = await backend.save(
          "recurring",
          value as unknown as Record<string, unknown>,
          id,
        );
        savedId = record.id;
        const savedOccs: RecurringOccurrenceRecord[] = [];
        if (!id && recurringModal?.historicalLinks?.length) {
          for (const link of recurringModal.historicalLinks) {
            try {
              const savedOcc = await backend.save("recurring_occurrences", {
                recurring_id: savedId,
                occurrence_date: link.occurrence_date,
                transaction_id: link.transaction_id,
                match_source: "auto",
                match_reason: "Linked from detected recurring pattern",
              });
              savedOccs.push(savedOcc);
            } catch (e) {
              console.error("Failed to link historical occurrence", e);
            }
          }
        }
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          recurring: id
            ? (l.recurring ?? []).map((r) => (r.id === id ? record : r))
            : [...(l.recurring ?? []), record],
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...savedOccs,
          ],
        }));
      }
      setRecurringModal(null);
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences(prefs: Partial<RecurringPreferences>) {
    if (busy) return;
    const currentPrefs = ledger.recurring_prefs ?? defaultRecurringPreferences;
    const nextPrefs: RecurringPreferences = {
      ...currentPrefs,
      ...prefs,
    };
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      if (demo) {
        setLedger((l) => ({
          ...l,
          recurring_prefs: nextPrefs,
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const saved = await backend.save(
          "recurring_prefs",
          nextPrefs as unknown as Record<string, unknown>,
          currentPrefs.id,
        );
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          recurring_prefs: saved,
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function acceptDetectedPattern(pattern: DetectedPattern) {
    if (busy) return;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      validateRecurringSchedule(pattern.draftSchedule, ledger);
      let scheduleId = "";
      if (demo) {
        scheduleId = demoId();
        const nextSchedule: RecurringSchedule = {
          ...pattern.draftSchedule,
          id: scheduleId,
        };
        const newOccurrences: RecurringOccurrenceRecord[] =
          pattern.historicalLinks.map((link) => ({
            id: demoId(),
            recurring_id: scheduleId,
            occurrence_date: link.occurrence_date,
            transaction_id: link.transaction_id,
            match_source: "auto",
            match_reason: "Linked from detected recurring pattern",
          }));
        setLedger((l) => ({
          ...l,
          recurring: [...(l.recurring ?? []), nextSchedule],
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...newOccurrences,
          ],
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const record = await backend.save(
          "recurring",
          pattern.draftSchedule as unknown as Record<string, unknown>,
        );
        scheduleId = record.id;
        const savedOccs: RecurringOccurrenceRecord[] = [];
        for (const link of pattern.historicalLinks) {
          try {
            const savedOcc = await backend.save("recurring_occurrences", {
              recurring_id: scheduleId,
              occurrence_date: link.occurrence_date,
              transaction_id: link.transaction_id,
              match_source: "auto",
              match_reason: "Linked from detected recurring pattern",
            });
            savedOccs.push(savedOcc);
          } catch (e) {
            console.error("Failed to link historical occurrence", e);
          }
        }
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          recurring: [...(l.recurring ?? []), record],
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...savedOccs,
          ],
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function editDetectedPattern(pattern: DetectedPattern) {
    setRecurringModal({
      open: true,
      initialDraft: pattern.draftSchedule,
      historicalLinks: pattern.historicalLinks,
    });
  }

  async function dismissPattern(patternKey: string) {
    const existing = ledger.recurring_prefs?.dismissed_keys ?? [];
    if (existing.includes(patternKey)) return;
    await savePreferences({ dismissed_keys: [...existing, patternKey] });
  }

  async function dismissMatchCandidate(matchKey: string) {
    const existing = ledger.recurring_prefs?.dismissed_keys ?? [];
    if (existing.includes(matchKey)) return;
    await savePreferences({ dismissed_keys: [...existing, matchKey] });
  }

  async function restoreDismissed() {
    await savePreferences({ dismissed_keys: [] });
  }

  async function runAutoReconciliation() {
    if (busy) return;
    const currentPrefs = ledger.recurring_prefs ?? defaultRecurringPreferences;
    if (currentPrefs.auto_match === "off") return;
    const recon = reconcileTransactions(ledger, { asOfDate: today() });
    if (!recon.autoLinks.length) return;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      if (demo) {
        const newOccs: RecurringOccurrenceRecord[] = recon.autoLinks.map(
          (al) => ({
            id: demoId(),
            recurring_id: al.schedule.id,
            occurrence_date: al.occurrenceDate,
            transaction_id: al.transaction.id,
            match_source: "auto",
            match_reason: al.summaryReason,
          }),
        );
        setLedger((l) => ({
          ...l,
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...newOccs,
          ],
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const savedOccs: RecurringOccurrenceRecord[] = [];
        for (const al of recon.autoLinks) {
          try {
            const saved = await backend.save("recurring_occurrences", {
              recurring_id: al.schedule.id,
              occurrence_date: al.occurrenceDate,
              transaction_id: al.transaction.id,
              match_source: "auto",
              match_reason: al.summaryReason,
            });
            savedOccs.push(saved);
          } catch (e) {
            console.error("Auto-link save failed", e);
          }
        }
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...savedOccs,
          ],
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function togglePauseRecurring(schedule: RecurringSchedule) {
    if (busy) return;
    const nextStatus = schedule.status === "paused" ? "active" : "paused";
    const { id, ...rest } = schedule;
    const nextValue: Omit<RecurringSchedule, "id"> = {
      ...rest,
      status: nextStatus,
    };
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      validateRecurringSchedule({ ...nextValue, id }, ledger);
      if (demo) {
        setLedger((l) => ({
          ...l,
          recurring: (l.recurring ?? []).map((r) =>
            r.id === id ? { ...nextValue, id } : r,
          ),
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const record = await backend.save(
          "recurring",
          nextValue as unknown as Record<string, unknown>,
          id,
        );
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          recurring: (l.recurring ?? []).map((r) => (r.id === id ? record : r)),
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmCreateOccurrence(
    schedule: RecurringSchedule,
    occurrenceDate: string,
    tx: Omit<Transaction, "id">,
  ) {
    if (busy) throw new Error("Another operation is running.");
    validateTransaction(tx, ledger);
    validateOccurrenceConfirmation(
      {
        recurring_id: schedule.id,
        occurrence_date: occurrenceDate,
        transaction_id: "__pending__",
      },
      {
        ...ledger,
        transactions: [...ledger.transactions, { ...tx, id: "__pending__" }],
      },
    );
    setBusy(true);
    const current = generation.current;
    try {
      if (demo) {
        const txRecord: Transaction = { ...tx, id: demoId() };
        const occRecord: RecurringOccurrenceRecord = {
          id: demoId(),
          recurring_id: schedule.id,
          occurrence_date: occurrenceDate,
          transaction_id: txRecord.id,
        };
        setLedger((l) => ({
          ...l,
          transactions: [...l.transactions, txRecord],
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            occRecord,
          ],
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const savedTx = await backend.save(
          "transactions",
          tx as unknown as Record<string, unknown>,
        );
        let savedOcc: RecurringOccurrenceRecord;
        try {
          savedOcc = await backend.save("recurring_occurrences", {
            recurring_id: schedule.id,
            occurrence_date: occurrenceDate,
            transaction_id: savedTx.id,
          });
        } catch (occErr) {
          let rolledBack = false;
          try {
            await backend.remove("transactions", savedTx.id);
            rolledBack = true;
          } catch {
            rolledBack = false;
          }
          if (!rolledBack && current === generation.current) {
            setLedger((l) => ({
              ...l,
              transactions: [...l.transactions, savedTx],
            }));
            throw new Error(
              "Transaction was saved, but linking the occurrence failed. Select it under “Link existing” to avoid recording it twice.",
            );
          }
          throw occErr;
        }
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          transactions: [...l.transactions, savedTx],
          recurring_occurrences: [...(l.recurring_occurrences ?? []), savedOcc],
        }));
      }
      setConfirmOcc(null);
    } finally {
      setBusy(false);
    }
  }
  async function confirmLinkOccurrence(
    schedule: RecurringSchedule,
    occurrenceDate: string,
    transactionId: string,
    existingConfirmationId?: string,
    matchSource: OccurrenceMatchSource = "manual",
    matchReason: string = "Manual link",
  ) {
    if (busy) throw new Error("Another operation is running.");
    const draft: Omit<RecurringOccurrenceRecord, "id"> = {
      recurring_id: schedule.id,
      occurrence_date: occurrenceDate,
      transaction_id: transactionId,
      match_source: matchSource,
      match_reason: matchReason,
    };
    validateOccurrenceConfirmation(
      draft,
      existingConfirmationId
        ? {
            ...ledger,
            recurring_occurrences: (ledger.recurring_occurrences ?? []).filter(
              (o) => o.id !== existingConfirmationId,
            ),
          }
        : ledger,
    );
    setBusy(true);
    const current = generation.current;
    try {
      if (demo) {
        if (existingConfirmationId) {
          setLedger((l) => ({
            ...l,
            recurring_occurrences: (l.recurring_occurrences ?? []).map((o) =>
              o.id === existingConfirmationId ? { ...o, ...draft } : o,
            ),
          }));
        } else {
          const occRecord: RecurringOccurrenceRecord = {
            ...draft,
            id: demoId(),
          };
          setLedger((l) => ({
            ...l,
            recurring_occurrences: [
              ...(l.recurring_occurrences ?? []),
              occRecord,
            ],
          }));
        }
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        const savedOcc = await backend.save(
          "recurring_occurrences",
          draft as unknown as Record<string, unknown>,
          existingConfirmationId,
        );
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          recurring_occurrences: existingConfirmationId
            ? (l.recurring_occurrences ?? []).map((o) =>
                o.id === existingConfirmationId ? savedOcc : o,
              )
            : [...(l.recurring_occurrences ?? []), savedOcc],
        }));
      }
      setConfirmOcc(null);
    } finally {
      setBusy(false);
    }
  }
  async function unlinkOccurrence(occurrenceId: string) {
    if (busy) return;
    const occ = (ledger.recurring_occurrences ?? []).find(
      (o) => o.id === occurrenceId,
    );
    const dismissKey = occ
      ? buildMatchDismissKey(
          occ.recurring_id,
          occ.occurrence_date,
          occ.transaction_id,
        )
      : null;
    const currentPrefs = ledger.recurring_prefs ?? defaultRecurringPreferences;
    const nextDismissed =
      dismissKey && !currentPrefs.dismissed_keys.includes(dismissKey)
        ? [...currentPrefs.dismissed_keys, dismissKey]
        : null;

    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      if (demo) {
        setLedger((l) => ({
          ...l,
          recurring_occurrences: (l.recurring_occurrences ?? []).filter(
            (o) => o.id !== occurrenceId,
          ),
          recurring_prefs: nextDismissed
            ? { ...currentPrefs, dismissed_keys: nextDismissed }
            : l.recurring_prefs,
        }));
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        await backend.remove("recurring_occurrences", occurrenceId);
        let updatedPrefs = ledger.recurring_prefs;
        if (nextDismissed) {
          try {
            updatedPrefs = await backend.save(
              "recurring_prefs",
              { ...currentPrefs, dismissed_keys: nextDismissed },
              currentPrefs.id,
            );
          } catch (e) {
            console.error("Failed to persist unlinked dismissal key", e);
          }
        }
        if (current !== generation.current) return;
        setLedger((l) => ({
          ...l,
          recurring_occurrences: (l.recurring_occurrences ?? []).filter(
            (o) => o.id !== occurrenceId,
          ),
          recurring_prefs: updatedPrefs ?? l.recurring_prefs,
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function importTransactions(
    rows: ImportTransaction[],
    progress: (n: number) => void,
    source = "Import",
    /** Called with how many rows (in order) are confirmed saved; may run after the caller has closed. */
    onSaved?: (n: number) => void,
  ) {
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
      onSaved?.(rows.length);
      return;
    }
    if (!backend || !session) throw new Error("Please sign in.");
    const api = backend;
    const stillOwner = ownerGuard();
    queue.enqueue({
      label: `${source} ${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}`,
      total: rows.length,
      run: async (ctx) => {
        checkOwner(stillOwner);
        try {
          await api.createMany(
            "transactions",
            rows,
            (saved, records) => {
              if (!stillOwner()) return;
              mergeRecords("transactions", records);
              ctx.progress(saved);
              onSaved?.(saved);
            },
            stillOwner,
          );
        } catch (e) {
          if (stillOwner()) await load();
          throw e;
        }
      },
    });
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
  function deleteMoneyAccount(account: Account) {
    const plural = (n: number, one: string) =>
      `${n} ${one}${n === 1 ? "" : "s"}`;
    const plan = planAccountDeletion(ledger, account.id);
    setError("");
    if (!demo) {
      if (!backend || !session) throw new Error("Please sign in.");
      const api = backend;
      const stillOwner = ownerGuard();
      const recurringCount = plan.recurringIds.length;
      const txCount = plan.transactionIds.length;
      const parts = [
        txCount && plural(txCount, "transaction"),
        recurringCount && plural(recurringCount, "schedule"),
      ].filter(Boolean);
      queue.enqueue({
        label: `Delete ${account.name}${parts.length ? ` · ${parts.join(", ")}` : ""}`,
        total: recurringCount + txCount + 1,
        run: async (ctx) => {
          checkOwner(stillOwner);
          let done = 0;
          try {
            if (recurringCount) {
              await api.removeMany("recurring", plan.recurringIds);
              done += recurringCount;
              ctx.progress(done);
            }
            await api.removeMany("transactions", plan.transactionIds, (ids) => {
              for (const id of ids) savedTx.current.delete(id);
              done += ids.length;
              ctx.progress(done);
            });
            checkOwner(stillOwner);
            await api.remove("accounts", account.id);
            // An earlier queued save may have put a deleted record back on screen.
            if (stillOwner())
              setLedger((l) => applyAccountDeletion(l, account.id, plan));
          } catch (e) {
            // Some records may already be gone; show what is left on the server.
            if (stillOwner()) await load();
            throw e;
          }
        },
      });
    }
    // Take the account off the screen straight away; a failure reloads the ledger.
    setLedger((l) => applyAccountDeletion(l, account.id, plan));
    const removed = new Set(plan.transactionIds);
    for (const id of removed) savedTx.current.delete(id);
    setSelected((old) => new Set([...old].filter((v) => !removed.has(v))));
    if (accountFilter === account.id) setAccountFilter("");
    setAccountToDelete(null);
  }
  /**
   * Deletes categories in the background queue. Their transactions and
   * recurring schedules move to `target` (null = uncategorized) first, because
   * the server refuses to delete a category that is still in use; their
   * budgets are deleted with them by the server.
   */
  function deleteCategories(ids: string[], target: string | null) {
    const first = planCategoryDeletion(ledger, ids);
    if (!first.categoryIds.length) throw new Error("Nothing to delete.");
    validateMoveTarget(ledger, first, target);
    const done = () => {
      const gone = new Set(first.categoryIds);
      setSelectedCategories(
        (old) => new Set([...old].filter((id) => !gone.has(id))),
      );
      setCategoriesToDelete(null);
    };
    if (demo) {
      setLedger((l) =>
        applyCategoryDeletion(l, planCategoryDeletion(l, ids), target),
      );
      done();
      return;
    }
    if (!backend || !session) throw new Error("Please sign in.");
    const api = backend;
    const stillOwner = ownerGuard();
    const n = first.categoryIds.length;
    const total = first.transactionIds.length + first.recurringIds.length + n;
    queue.enqueue({
      label: `Delete ${n} ${n === 1 ? "category" : "categories"}`,
      total,
      run: async (ctx) => {
        checkOwner(stillOwner);
        // Plan again when the task starts: earlier queued work may have
        // added transactions to these categories since.
        // Include records an earlier task saved that React hasn't rendered yet.
        const current = ledgerRef.current;
        const fresh = new Map(current.transactions.map((t) => [t.id, t]));
        for (const [id, t] of savedTx.current) fresh.set(id, t);
        const latest: Ledger = {
          ...current,
          transactions: [...fresh.values()],
        };
        const plan = planCategoryDeletion(latest, ids);
        if (!plan.categoryIds.length) return;
        validateMoveTarget(latest, plan, target);
        let saved = 0;
        try {
          const moved = movedTransactions(latest, plan, target);
          if (moved.length)
            await api.updateTransactions(
              moved,
              (count, records) => {
                if (!stillOwner()) return;
                updateTransactions(records);
                ctx.progress(Math.min(total, count));
              },
              stillOwner,
            );
          saved = moved.length;
          for (const id of plan.recurringIds) {
            checkOwner(stillOwner);
            const schedule = (ledgerRef.current.recurring ?? []).find(
              (r) => r.id === id,
            );
            if (!schedule) continue;
            const { id: _id, ...value } = schedule;
            const record = await api.save(
              "recurring",
              { ...value, category_id: target },
              id,
            );
            if (!stillOwner()) return;
            setLedger((l) => ({
              ...l,
              recurring: (l.recurring ?? []).map((r) =>
                r.id === id ? record : r,
              ),
            }));
            ctx.progress(Math.min(total, ++saved));
          }
          checkOwner(stillOwner);
          await api.removeMany("categories", plan.categoryIds, (deleted) => {
            if (!stillOwner()) return;
            const gone = new Set(deleted);
            setLedger((l) => ({
              ...l,
              categories: l.categories.filter((c) => !gone.has(c.id)),
              budgets: (l.budgets ?? []).filter(
                (b) => !gone.has(b.category_id),
              ),
            }));
            saved += deleted.length;
            ctx.progress(Math.min(total, saved));
          });
        } catch (e) {
          if (stillOwner()) await load();
          throw e;
        }
      },
    });
    done();
  }
  async function remove(
    table: "categories" | "transactions" | "recurring" | "budgets",
    id: string,
  ) {
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
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      if (table === "categories") {
        if (ledger.transactions.some((t) => t.category_id === id))
          throw new Error("Reassign this category’s transactions first.");
        if ((ledger.recurring ?? []).some((r) => r.category_id === id))
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
  if (checking) return <div className="loading">Opening Fuloos…</div>;
  if (!session && !demo)
    return <Auth onDemo={startDemo} externalError={error} />;
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const start = new Date(`${month}-01T00:00:00Z`);
  const span = isPeriodSpan(view) ? view : "month";
  const firstMonth = periodMonths(span, month, rangeFrom)?.first ?? month;
  start.setTime(Date.parse(`${firstMonth}-01T00:00:00Z`));
  const rangeLabel = periodLabel(span, month, rangeFrom);
  const activeMonths = new Set(
    ledger.transactions.map((t) => t.date.slice(0, 7)),
  );
  const monthly = ledger.transactions.filter(
      (t) =>
        view === "all" ||
        (t.date >= start.toISOString().slice(0, 10) &&
          t.date < end.toISOString().slice(0, 10)),
    ),
    summary = totals(monthly),
    net = ledger.accounts.reduce(
      (s, a) => s + balance(a, ledger.transactions),
      0,
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
  const categoryCounts = new Map<string, number>();
  for (const t of ledger.transactions)
    if (t.category_id)
      categoryCounts.set(
        t.category_id,
        (categoryCounts.get(t.category_id) ?? 0) + 1,
      );
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
  const concealed = (v: number) => (hidden ? "••••••" : money(v));
  const budgetRangeStart =
    view === "all"
      ? (ledger.budgets ?? []).reduce(
          (first, b) => (b.start_month < first ? b.start_month : first),
          month,
        )
      : start.toISOString().slice(0, 7);
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
            { name: "Recurring", icon: Repeat },
            { name: "Budgets", icon: PiggyBank },
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
                if (name === "Recurring") {
                  setRecurringFilter("all");
                  setRecurringTab("schedules");
                }
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
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon size={18} />
          </button>
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
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onDeleteAccount={
            !demo && session
              ? () => {
                  setSettingsOpen(false);
                  setDeleteOpen(true);
                }
              : undefined
          }
        />
      )}
      {deleteOpen && backend && session && (
        <DeleteAccountDialog
          email={session.user.email}
          onClose={() => setDeleteOpen(false)}
          onDelete={async (progress) => {
            try {
              await backend!.deleteAccount(progress);
            } catch (e) {
              // Some records may already be gone; show what is left on the server.
              void load();
              throw e;
            }
            setDeleteOpen(false);
            setLedger(emptyLedger);
          }}
        />
      )}
      {accountToDelete && (
        <DeleteMoneyAccountDialog
          account={accountToDelete}
          plan={planAccountDeletion(ledger, accountToDelete.id)}
          onClose={() => setAccountToDelete(null)}
          onDelete={() => deleteMoneyAccount(accountToDelete)}
        />
      )}
      {categoriesToDelete && (
        <DeleteCategoriesDialog
          categories={ledger.categories.filter((c) =>
            categoriesToDelete.includes(c.id),
          )}
          plan={planCategoryDeletion(ledger, categoriesToDelete)}
          remaining={ledger.categories.filter(
            (c) => !categoriesToDelete.includes(c.id),
          )}
          onClose={() => setCategoriesToDelete(null)}
          onDelete={(target) => deleteCategories(categoriesToDelete, target)}
        />
      )}
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
            <button
              type="button"
              className="small-avatar"
              aria-label="Settings"
              title="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              {demo ? "D" : session?.user.email?.slice(0, 1).toUpperCase()}
            </button>
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
                  : page === "Recurring"
                    ? "Subscriptions, bills and regular income — balances stay untouched until paid."
                    : page === "Budgets"
                      ? "Monthly limits per category, and how your spending measures up."
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
              onClick={() => {
                if (page === "Recurring") {
                  setRecurringModal({ open: true });
                } else if (page === "Budgets") {
                  setBudgetModal({ draft: { start_month: month } });
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
            >
              <Plus size={18} />
              {page === "Accounts"
                ? "Add account"
                : page === "Categories"
                  ? "Add category"
                  : page === "Recurring"
                    ? "Add recurring"
                    : page === "Budgets"
                      ? "Add budget"
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
          {(page === "Overview" ||
            page === "Transactions" ||
            page === "Reports") && (
            <div className="period-row">
              <PeriodPicker
                label="Date range"
                month={month}
                from={rangeFrom}
                span={span}
                spans={["month", "custom", "ytd", "12", "all"]}
                currentMonth={today().slice(0, 7)}
                activeMonths={activeMonths}
                onChange={(next) => {
                  setView(next.span);
                  setMonth(next.month);
                  if (next.from) setRangeFrom(next.from);
                }}
              />
              <span className="muted">
                {periodDates(span, month, rangeFrom)}
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
                      <button
                        className="text-button"
                        onClick={() => setPage("Reports")}
                      >
                        <h2>Where it went</h2>
                        <ArrowRight size={16} />
                      </button>
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
              <DashboardRecurring
                ledger={ledger}
                month={month}
                concealed={concealed}
                busy={busy}
                onOpenRecurring={(tab = "schedules", filter = "all") => {
                  setRecurringTab(tab);
                  setRecurringFilter(filter);
                  setPage("Recurring");
                }}
                onConfirm={(schedule, occurrenceDate) =>
                  setConfirmOcc({ schedule, occurrenceDate })
                }
              />
            </>
          )}
          {page === "Recurring" && (
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
          )}
          {page === "Budgets" && (
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
          )}
          {page === "Reports" && (
            <BudgetReportPanel
              ledger={ledger}
              startMonth={budgetRangeStart}
              endMonth={month}
              rangeLabel={
                view === "all"
                  ? `Every budgeted month through ${monthLabel(month)}`
                  : rangeLabel
              }
              concealed={concealed}
              onManage={() => setPage("Budgets")}
            />
          )}
          {page === "Reports" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Where it went</h2>
                <span>{rangeLabel}</span>
              </div>
              <div className="filters">
                <b>Income {concealed(summary.income)}</b>
                <b>Expenses {concealed(summary.expense)}</b>
                <b>
                  Net cash flow {concealed(summary.income - summary.expense)}
                </b>
              </div>
              {spending.map((c) => (
                <div className="category-item" key={c.id}>
                  <span className="category-symbol" style={{ color: c.color }}>
                    <Tags size={20} />
                  </span>
                  <div>
                    <b>{c.name}</b>
                    <p>
                      {((c.total / summary.expense) * 100).toFixed(1)}% of
                      spending
                    </p>
                    <progress
                      aria-label={`${c.name} share of spending`}
                      value={c.total}
                      max={summary.expense}
                    />
                  </div>
                  <strong>{concealed(c.total)}</strong>
                </div>
              ))}
              {!spending.length && (
                <Empty
                  title="No spending in this period"
                  text="Choose another date range to explore your spending."
                />
              )}
            </section>
          )}
          {page === "Accounts" && (
            <>
              <div className="accounts-summary">
                <span>Total net balance</span>
                <strong>{concealed(net)}</strong>
                <small>
                  Credit card debt is shown as a negative balance. Enter a
                  negative balance for amounts you owe.
                </small>
              </div>
              {density === "compact" ? (
                <section className="panel compact-list">
                  <div className="compact-head accounts" aria-hidden>
                    <span>Account</span>
                    <span>Type</span>
                    <span>Balance set</span>
                    <span className="num">Balance</span>
                    <span />
                  </div>
                  {ledger.accounts.map((a) => {
                    const value = balance(a, ledger.transactions);
                    return (
                      <div className="compact-row accounts" key={a.id}>
                        <button
                          className="compact-name"
                          onClick={() => {
                            setPage("Transactions");
                            setAccountFilter(a.id);
                          }}
                          title={`View ${a.name} transactions`}
                        >
                          <span
                            className="compact-symbol"
                            style={{
                              background: a.color + "18",
                              color: a.color,
                            }}
                          >
                            {a.emoji || <Wallet size={15} />}
                          </span>
                          <b>{a.name}</b>
                        </button>
                        <span className="muted">{types[a.type]}</span>
                        <span className="muted">{balanceNote(a, true)}</span>
                        <strong
                          className={`num ${value < 0 ? "is-negative" : ""}`}
                        >
                          {concealed(value)}
                        </strong>
                        <span className="compact-actions">
                          <button
                            className="icon-button"
                            aria-label={`Edit ${a.name}`}
                            onClick={() =>
                              setModal({ kind: "account", item: a })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={busy}
                            aria-label={`Delete ${a.name}`}
                            onClick={() => setAccountToDelete(a)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                  {!ledger.accounts.length && (
                    <Empty
                      title="No accounts yet"
                      text="Add a current, savings, credit card or cash account."
                    />
                  )}
                </section>
              ) : (
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
                            onClick={() =>
                              setModal({ kind: "account", item: a })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={busy}
                            aria-label={`Delete ${a.name}`}
                            onClick={() => setAccountToDelete(a)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <h3>{a.name}</h3>
                      <strong className="large-amount">
                        {concealed(balance(a, ledger.transactions))}
                      </strong>
                      <p className="muted small">{balanceNote(a)}</p>
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
              )}
            </>
          )}
          {page === "Categories" && ledger.categories.length > 0 && (
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
              <span className="muted small">
                {selectedCategories.size} selected
              </span>
              <button
                className="secondary danger-outline"
                disabled={busy || !selectedCategories.size}
                onClick={() =>
                  setCategoriesToDelete(
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
          {page === "Categories" && density === "compact" && (
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
                      onClick={() => setModal({ kind: "category", item: c })}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Delete ${c.name}`}
                      onClick={() => setCategoriesToDelete([c.id])}
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
          )}
          {page === "Categories" && density === "relaxed" && (
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
                        onClick={() => setModal({ kind: "category", item: c })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Delete ${c.name}`}
                        onClick={() => setCategoriesToDelete([c.id])}
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
                    {categoryCounts.get(c.id) ?? 0} transaction
                    {categoryCounts.get(c.id) === 1 ? "" : "s"}
                  </span>
                </article>
              ))}
              <button
                className="add-account-card"
                onClick={() => setModal({ kind: "category" })}
              >
                <span>
                  <Plus size={22} />
                </span>
                <b>Add a category</b>
                <small>Groceries, rent, salary, anything</small>
              </button>
            </div>
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
              onEditSelected={setBulkItems}
              onEdit={(t) => setModal({ kind: "transaction", item: t })}
              onDelete={(t) => void remove("transactions", t.id)}
              onCategorize={(t, categoryId) => void categorize(t, categoryId)}
            />
          )}
          <footer>
            <Leaf size={14} />
            <span>A little more clarity. A little less worry.</span>
            <span className="footer-brand">Made for your everyday.</span>
          </footer>
        </div>
      </main>
      <QueueDock queue={queue} />
      {bulkItems && (
        <BulkEdit
          items={bulkItems}
          ledger={ledger}
          onClose={() => {
            if (!busy) setBulkItems(null);
          }}
          onApply={bulkUpdate}
        />
      )}
      {importOpen && (
        <CsvImport
          ledger={ledger}
          onClose={() => setImportOpen(false)}
          onImport={(rows, progress) =>
            importTransactions(rows, progress, "CSV import:")
          }
          onCreateCategories={createCategories}
          presetStore={presetStore}
          onCreateCategory={async (value) => {
            await save("categories", value);
          }}
        />
      )}
      {smsOpen && (
        <SmsImport
          ledger={ledger}
          owner={demo ? "demo" : (session?.user.id ?? "anonymous")}
          learning={learningStore}
          onClose={() => setSmsOpen(false)}
          onImport={(rows, progress, onSaved) =>
            importTransactions(rows, progress, "SMS import:", onSaved)
          }
        />
      )}
      {recurringModal && (
        <RecurringEditorModal
          item={recurringModal.item}
          initialDraft={recurringModal.initialDraft}
          ledger={ledger}
          concealed={concealed}
          busy={busy}
          onClose={() => {
            if (!busy) setRecurringModal(null);
          }}
          onSave={saveRecurring}
          onUnlinkOccurrence={(occurrenceId) =>
            void unlinkOccurrence(occurrenceId)
          }
        />
      )}
      {budgetModal && (
        <BudgetEditorModal
          ledger={ledger}
          item={budgetModal.item}
          draft={budgetModal.draft}
          busy={busy}
          onClose={() => {
            if (!busy) setBudgetModal(null);
          }}
          onSave={saveBudget}
        />
      )}
      {confirmOcc && (
        <ConfirmOccurrenceModal
          schedule={confirmOcc.schedule}
          occurrenceDate={confirmOcc.occurrenceDate}
          existingConfirmation={confirmOcc.existingConfirmation}
          ledger={ledger}
          busy={busy}
          onClose={() => {
            if (!busy) setConfirmOcc(null);
          }}
          onConfirmCreate={confirmCreateOccurrence}
          onConfirmLink={confirmLinkOccurrence}
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
          onUnlinkOccurrence={(occurrenceId) =>
            void unlinkOccurrence(occurrenceId)
          }
        />
      )}
    </div>
  );
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
  selected,
  onSelect,
}: {
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  items: Transaction[];
  ledger: Ledger;
  concealed: (v: number) => string;
  onEdit: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
  busy?: boolean;
}) {
  const balances = useMemo(() => {
    const result = new Map<string, { source: number; destination: number }>();
    const running = new Map(
      ledger.accounts.map((a) => [
        a.id,
        startingBalance(a, ledger.transactions),
      ]),
    );
    // IDs provide a consistent order where only a transaction date is available.
    for (const t of [...ledger.transactions].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    )) {
      running.set(
        t.account_id,
        (running.get(t.account_id) ?? 0) +
          (t.type === "income" ? t.amount : -t.amount),
      );
      if (t.to_account_id)
        running.set(
          t.to_account_id,
          (running.get(t.to_account_id) ?? 0) + t.amount,
        );
      result.set(t.id, {
        source: running.get(t.account_id) ?? 0,
        destination: t.to_account_id ? (running.get(t.to_account_id) ?? 0) : 0,
      });
    }
    return result;
  }, [ledger.accounts, ledger.transactions]);
  return items.length ? (
    <div className="transaction-list">
      {items.map((t) => {
        const category = ledger.categories.find((c) => c.id === t.category_id);
        const account = ledger.accounts.find((a) => a.id === t.account_id);
        return (
          <div
            className={`transaction-row ${selected?.has(t.id) ? "is-selected" : ""}`}
            key={t.id}
          >
            {onSelect && (
              <input
                className="transaction-select"
                type="checkbox"
                aria-label={`Select ${t.payee || "transaction"} on ${t.date}`}
                disabled={busy}
                checked={selected?.has(t.id) ?? false}
                onChange={() => onSelect(t.id)}
              />
            )}
            <button
              className="transaction-main"
              disabled={busy}
              onClick={() => onEdit(t)}
            >
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
                <small>
                  {account?.name}: {concealed(balances.get(t.id)?.source ?? 0)}{" "}
                  balance
                </small>
                {t.to_account_id && (
                  <small>
                    {
                      ledger.accounts.find((a) => a.id === t.to_account_id)
                        ?.name
                    }
                    : {concealed(balances.get(t.id)?.destination ?? 0)} balance
                  </small>
                )}
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
      .catch((e) => setError(errorMessage(e)))
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
      setError(errorMessage(e));
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
  onUnlinkOccurrence,
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
  onUnlinkOccurrence: (occurrenceId: string) => void;
}) {
  const item = modal.item;
  const [kind, setKind] = useState<Kind>(
      modal.kind === "transaction" && modal.item ? modal.item.type : "expense",
    ),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const linkedOccurrence = useMemo(
    () =>
      modal.kind === "transaction" && modal.item
        ? (ledger.recurring_occurrences ?? []).find(
            (o) => o.transaction_id === modal.item!.id,
          )
        : undefined,
    [modal, ledger.recurring_occurrences],
  );
  const linkedSchedule = useMemo(
    () =>
      linkedOccurrence
        ? (ledger.recurring ?? []).find(
            (r) => r.id === linkedOccurrence.recurring_id,
          )
        : undefined,
    [linkedOccurrence, ledger.recurring],
  );
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
        const balanceText = s("balance");
        const asOf = s("balance_as_of") || today();
        if (balanceText && !isIsoCalendarDate(asOf))
          throw new Error("Choose a valid date for the balance.");
        const value = {
          name: s("name"),
          type: s("type"),
          // No balance given: the balance is just the sum of transactions.
          opening_balance: balanceText ? minor(balanceText) : 0,
          opening_date: balanceText ? openingDateFor(asOf) : NO_BALANCE_DATE,
          color: s("color"),
          emoji: s("emoji"),
        };
        if (!value.name) throw new Error("Enter an account name.");
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
        validateTransaction({ ...value, id: item?.id }, ledger);
        await save("transactions", value, item?.id);
      }
    } catch (e) {
      setError(errorMessage(e));
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
            {linkedOccurrence && (
              <div className="notice linked-banner">
                <span>
                  Linked to{" "}
                  <b>{linkedSchedule?.name ?? "recurring schedule"}</b> (
                  {linkedOccurrence.occurrence_date})
                </span>
                <button
                  type="button"
                  className="secondary compact-btn"
                  disabled={busy}
                  onClick={() => onUnlinkOccurrence(linkedOccurrence.id)}
                >
                  <Unlink size={13} /> Unlink
                </button>
              </div>
            )}
            <div className="type-switch">
              {(["expense", "income", "transfer"] as const).map((k) => (
                <button
                  type="button"
                  disabled={Boolean(
                    linkedSchedule && k !== linkedSchedule.type,
                  )}
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
                Balance (AED) <span className="muted">Optional</span>
                <input
                  inputMode="decimal"
                  name="balance"
                  placeholder="e.g. 12500.00"
                  defaultValue={
                    modal.item && hasBalanceAnchor(modal.item)
                      ? (modal.item.opening_balance / 100).toFixed(2)
                      : ""
                  }
                />
              </label>
              <label>
                As of end of
                <input
                  name="balance_as_of"
                  type="date"
                  defaultValue={
                    modal.item && hasBalanceAnchor(modal.item)
                      ? balanceAsOfDate(modal.item)
                      : today()
                  }
                />
              </label>
            </div>
            <p className="form-hint">
              Enter what your bank shows at the end of a day. Transactions after
              that day are added to it. Earlier ones are already part of it, so
              you can add past transactions at any time without changing this
              balance. Leave it blank to just add up your transactions. Use a
              negative balance for credit card debt or an overdraft.
              {modal.item && (
                <>
                  {" "}
                  The app currently shows{" "}
                  {money(balance(modal.item, ledger.transactions))} for this
                  account.
                </>
              )}
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
    <ConfirmHost />
  </React.StrictMode>,
);
