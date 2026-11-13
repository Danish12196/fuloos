import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { applyAccountDeletion, planAccountDeletion } from "./accountDeletion";
import {
  applyCategoryDeletion,
  movedTransactions,
  planCategoryDeletion,
  validateMoveTarget,
} from "./categoryDeletion";
import { backend, type Session } from "./client";
import { plural, type Account, type Ledger, type Transaction } from "./domain";
import type { TaskQueue } from "./taskQueue";
import {
  applyTransactionDeletion,
  planTransactionDeletion,
} from "./transactionDeletion";

export function useDeletionActions({
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
}: {
  demo: boolean;
  session: Session | null;
  queue: TaskQueue;
  ledger: Ledger;
  setLedger: Dispatch<SetStateAction<Ledger>>;
  ledgerRef: MutableRefObject<Ledger>;
  savedTx: MutableRefObject<Map<string, Transaction>>;
  ownerGuard: () => () => boolean;
  checkOwner: (stillOwner: () => boolean) => void;
  load: () => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  setSelectedCategories: Dispatch<SetStateAction<Set<string>>>;
  accountFilter: string;
  setAccountFilter: Dispatch<SetStateAction<string>>;
  updateTransactions: (records: Transaction[]) => void;
}) {
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);
  const [categoriesToDelete, setCategoriesToDelete] = useState<string[] | null>(
    null,
  );
  const [transactionsToDelete, setTransactionsToDelete] = useState<
    string[] | null
  >(null);

  function deleteMoneyAccount(account: Account) {
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
          const livePlan = planAccountDeletion(ledgerRef.current, account.id);
          const recurringIds = [
            ...new Set([...plan.recurringIds, ...livePlan.recurringIds]),
          ];
          const transactionIds = [
            ...new Set([...plan.transactionIds, ...livePlan.transactionIds]),
          ];
          const totalWork = recurringIds.length + transactionIds.length + 1;
          let done = 0;
          try {
            if (recurringIds.length) {
              await api.removeMany("recurring", recurringIds);
              done += recurringIds.length;
              ctx.progress(Math.min(done, totalWork));
            }
            await api.removeMany("transactions", transactionIds, (ids) => {
              for (const id of ids) savedTx.current.delete(id);
              done += ids.length;
              ctx.progress(Math.min(done, totalWork));
            });
            checkOwner(stillOwner);
            await api.remove("accounts", account.id);
            // An earlier queued save may have put a deleted record back on screen.
            if (stillOwner())
              setLedger((l) =>
                applyAccountDeletion(l, account.id, {
                  recurringIds,
                  transactionIds,
                  transferCount: livePlan.transferCount,
                }),
              );
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
  /**
   * Deletes several transactions in the background queue. They leave the
   * screen at once; a failure reloads the ledger to show what is left. A
   * transfer is one record, so both of its sides go together, and the server
   * unlinks any recurring occurrences recorded with them.
   */
  function deleteTransactions(ids: string[]) {
    const plan = planTransactionDeletion(ledger, ids);
    const n = plan.transactionIds.length;
    if (!n) throw new Error("Nothing to delete.");
    const finish = () => {
      const gone = new Set(plan.transactionIds);
      for (const id of gone) savedTx.current.delete(id);
      setLedger((l) => applyTransactionDeletion(l, gone));
      setSelected((old) => new Set([...old].filter((id) => !gone.has(id))));
      setTransactionsToDelete(null);
    };
    if (demo) {
      finish();
      return;
    }
    if (!backend || !session) throw new Error("Please sign in.");
    const api = backend;
    const stillOwner = ownerGuard();
    queue.enqueue({
      label: `Delete ${n} ${n === 1 ? "transaction" : "transactions"}`,
      total: n,
      run: async (ctx) => {
        checkOwner(stillOwner);
        let done = 0;
        try {
          await api.removeMany("transactions", plan.transactionIds, (gone) => {
            for (const id of gone) savedTx.current.delete(id);
            done += gone.length;
            ctx.progress(done);
          });
          // An earlier queued save may have put a deleted record back on screen.
          if (stillOwner())
            setLedger((l) => applyTransactionDeletion(l, plan.transactionIds));
        } catch (e) {
          // Some records may already be gone; show what is left on the server.
          if (stillOwner()) await load();
          throw e;
        }
      },
    });
    finish();
  }

  return {
    accountToDelete,
    setAccountToDelete,
    categoriesToDelete,
    setCategoriesToDelete,
    transactionsToDelete,
    setTransactionsToDelete,
    deleteMoneyAccount,
    deleteCategories,
    deleteTransactions,
  };
}
