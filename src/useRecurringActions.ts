import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { backend, type Session } from "./client";
import {
  defaultRecurringPreferences,
  errorMessage,
  today,
  validateTransaction,
  type Ledger,
  type OccurrenceMatchSource,
  type RecurringOccurrenceRecord,
  type RecurringPreferences,
  type RecurringSchedule,
  type Transaction,
} from "./domain";
import {
  validateOccurrenceConfirmation,
  validateRecurringSchedule,
} from "./recurring";
import { buildMatchDismissKey } from "./recurringMerchant";
import type { DetectedPattern } from "./recurringDetection";
import { reconcileTransactions } from "./recurringReconcile";
import type { RecurringTab } from "./RecurringView";

export function useRecurringActions({
  demo,
  session,
  ledger,
  setLedger,
  busy,
  setBusy,
  setError,
  generation,
  demoId,
}: {
  demo: boolean;
  session: Session | null;
  ledger: Ledger;
  setLedger: Dispatch<SetStateAction<Ledger>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  generation: MutableRefObject<number>;
  demoId: () => string;
}) {
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

  async function saveOccurrenceLinks(
    api: NonNullable<typeof backend>,
    links: {
      recurring_id: string;
      occurrence_date: string;
      transaction_id: string;
      match_source: "auto";
      match_reason: string;
    }[],
    current: number,
  ): Promise<{
    saved: RecurringOccurrenceRecord[];
    failed: number;
    firstError: unknown;
  }> {
    const saved: RecurringOccurrenceRecord[] = [];
    let failed = 0;
    let firstError: unknown;
    for (const link of links) {
      if (current !== generation.current) break;
      try {
        saved.push(await api.save("recurring_occurrences", link));
      } catch (e) {
        failed++;
        if (firstError === undefined) firstError = e;
      }
    }
    return { saved, failed, firstError };
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
        let savedOccs: RecurringOccurrenceRecord[] = [];
        if (!id && recurringModal?.historicalLinks?.length) {
          const res = await saveOccurrenceLinks(
            backend,
            recurringModal.historicalLinks.map((link) => ({
              recurring_id: savedId!,
              occurrence_date: link.occurrence_date,
              transaction_id: link.transaction_id,
              match_source: "auto" as const,
              match_reason: "Linked from detected recurring pattern",
            })),
            current,
          );
          savedOccs = res.saved;
          if (res.failed > 0 && current === generation.current) {
            setError(
              `Could not save ${res.failed} occurrence ${res.failed === 1 ? "link" : "links"}: ${errorMessage(res.firstError)}`,
            );
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
        const res = await saveOccurrenceLinks(
          backend,
          pattern.historicalLinks.map((link) => ({
            recurring_id: scheduleId,
            occurrence_date: link.occurrence_date,
            transaction_id: link.transaction_id,
            match_source: "auto" as const,
            match_reason: "Linked from detected recurring pattern",
          })),
          current,
        );
        if (current !== generation.current) return;
        if (res.failed > 0) {
          setError(
            `Could not save ${res.failed} occurrence ${res.failed === 1 ? "link" : "links"}: ${errorMessage(res.firstError)}`,
          );
        }
        setLedger((l) => ({
          ...l,
          recurring: [...(l.recurring ?? []), record],
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...res.saved,
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
        const res = await saveOccurrenceLinks(
          backend,
          recon.autoLinks.map((al) => ({
            recurring_id: al.schedule.id,
            occurrence_date: al.occurrenceDate,
            transaction_id: al.transaction.id,
            match_source: "auto" as const,
            match_reason: al.summaryReason,
          })),
          current,
        );
        if (current !== generation.current) return;
        if (res.failed > 0) {
          setError(
            `Could not save ${res.failed} occurrence ${res.failed === 1 ? "link" : "links"}: ${errorMessage(res.firstError)}`,
          );
        }
        setLedger((l) => ({
          ...l,
          recurring_occurrences: [
            ...(l.recurring_occurrences ?? []),
            ...res.saved,
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
            if (current === generation.current)
              setError(`Could not save dismissal preference: ${errorMessage(e)}`);
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

  return {
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
  };
}
