import { BulkEdit } from "./BulkEdit";
import { ColorPicker, EmojiField } from "./Appearance";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { backend, type Session } from "./client";
import { CsvImport } from "./CsvImport";
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
import {
  ArrowDownLeft,
  ArrowUpRight,
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
  ChevronLeft,
  ChevronRight,
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
  emptyLedger,
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
  useEffect(() => {
    setSelected(new Set());
    setBudgetModal(null);
    setBulkItems(null);
    setRecurringModal(null);
    setConfirmOcc(null);
    setRecurringTab("schedules");
    setRecurringFilter("all");
  }, [session?.user.id, demo]);
  function toggleSelection(id: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function updateTransactions(records: Transaction[]) {
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
    if (busy) throw new Error("Another operation is running.");
    rows.forEach((t) => validateTransaction(t, ledger));
    const current = generation.current;
    setBusy(true);
    try {
      if (demo) {
        updateTransactions(rows);
        progress(rows);
      } else {
        if (!backend || !session) throw new Error("Please sign in.");
        await backend.updateTransactions(
          rows,
          (_n, records) => {
            if (current !== generation.current) return;
            updateTransactions(records);
            progress(records);
          },
          () => current === generation.current,
        );
      }
    } finally {
      setBusy(false);
    }
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
      if (current === generation.current) setLedger(data);
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
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            savedOcc,
          ],
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
  async function remove(
    table: "accounts" | "categories" | "transactions" | "recurring" | "budgets",
    id: string,
  ) {
    const promptText =
      table === "recurring"
        ? "Delete this recurring schedule? Past recorded transactions will stay in your ledger."
        : table === "budgets"
          ? "Delete this budget? Your transactions are not affected."
          : table === "categories" &&
              (ledger.budgets ?? []).some((b) => b.category_id === id)
            ? "Delete this category? Its budgets will be removed too. This cannot be undone."
            : "Delete this item? This cannot be undone.";
    if (!window.confirm(promptText)) return;
    setBusy(true);
    setError("");
    try {
      if (table === "accounts") {
        if (
          ledger.transactions.some(
            (t) => t.account_id === id || t.to_account_id === id,
          )
        )
          throw new Error("Delete or move this account’s transactions first.");
        if ((ledger.recurring ?? []).some((r) => r.account_id === id))
          throw new Error(
            "Delete or reassign this account’s recurring schedules first.",
          );
      }
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
        return {
          ...l,
          [table]: l[table].filter((v) => v.id !== id),
        } as Ledger;
      };
      if (demo) setLedger(applyRemoval);
      else {
        if (!backend || !session) throw new Error("Please sign in.");
        const current = generation.current;
        await backend.remove(table, id);
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
  if (view === "3" || view === "6" || view === "12")
    start.setUTCMonth(start.getUTCMonth() - Number(view) + 1);
  if (view === "ytd") start.setUTCMonth(0);
  const rangeLabel =
    view === "all"
      ? "All time"
      : `${start.toISOString().slice(0, 10)} – ${new Date(end.getTime() - 86400000).toISOString().slice(0, 10)}`;
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
                if (name === "Recurring") { setRecurringFilter("all"); setRecurringTab("schedules"); }
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
              <select
                aria-label="Date range"
                value={view}
                onChange={(e) => {
                  setView(e.target.value);
                  setMonth(today().slice(0, 7));
                }}
              >
                <option value="month">Month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="ytd">Year to date</option>
                <option value="12">1 year</option>
                <option value="all">All time</option>
              </select>
              <div className="month-control">
                <button
                  className="icon-button"
                  aria-label="Previous month"
                  onClick={() => setMonth((m) => shiftMonth(m, -1))}
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
                  onClick={() => setMonth((m) => shiftMonth(m, 1))}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <span className="muted">{rangeLabel}</span>
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
              onMonthChange={setMonth}
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
              <div className="bulk-toolbar">
                <label className="selection-label">
                  <input
                    type="checkbox"
                    disabled={busy || loading || !filtered.length}
                    checked={
                      filtered.length > 0 &&
                      filtered.every((t) => selected.has(t.id))
                    }
                    onChange={(e) =>
                      setSelected((old) => {
                        const next = new Set(old);
                        for (const t of filtered) {
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                        }
                        return next;
                      })
                    }
                  />
                  Select all {filtered.length} results
                </label>
                <span>
                  {selected.size} selected ·{" "}
                  {filtered.filter((t) => selected.has(t.id)).length} in these
                  results
                </span>
                <button
                  className="secondary"
                  disabled={busy || loading || !selected.size}
                  onClick={() =>
                    setBulkItems(
                      ledger.transactions.filter((t) => selected.has(t.id)),
                    )
                  }
                >
                  Edit selected
                </button>
                <button
                  className="text-button"
                  disabled={busy || !selected.size}
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </button>
              </div>
              <TransactionList
                selected={selected}
                onSelect={toggleSelection}
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
          onImport={importTransactions}
          onCreateCategories={createCategories}
          onCreateCategory={async (value) => {
            await save("categories", value);
          }}
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
      ledger.accounts.map((a) => [a.id, a.opening_balance]),
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
                  disabled={Boolean(linkedSchedule && k !== linkedSchedule.type)}
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
