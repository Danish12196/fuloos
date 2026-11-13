import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { rebaseEdit } from "./bulk";
import { backend, type Session } from "./client";
import type { ImportTransaction } from "./csv";
import {
  validateTransaction,
  type Category,
  type Ledger,
  type Transaction,
} from "./domain";
import type { TaskQueue } from "./taskQueue";

export function useImportAndBulk({
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
}: {
  demo: boolean;
  session: Session | null;
  queue: TaskQueue;
  ledger: Ledger;
  setLedger: Dispatch<SetStateAction<Ledger>>;
  ledgerRef: MutableRefObject<Ledger>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  generation: MutableRefObject<number>;
  demoId: () => string;
  ownerGuard: () => () => boolean;
  checkOwner: (stillOwner: () => boolean) => void;
  load: () => Promise<void>;
  latestTransaction: (id: string) => Transaction | undefined;
  mergeRecords: <K extends "transactions" | "categories">(
    key: K,
    records: Ledger[K],
  ) => void;
  updateTransactions: (records: Transaction[]) => void;
}) {
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

  async function importTransactions(
    rows: ImportTransaction[],
    progress: (n: number) => void,
    source = "Import",
    onSaved?: (n: number) => void,
    paired: Transaction[] = [],
  ) {
    rows.forEach((row) => validateTransaction(row, ledger));
    paired.forEach((t) => validateTransaction(t, ledger));
    const count = rows.length + paired.length;
    if (demo) {
      const byId = new Map(paired.map((t) => [t.id, t]));
      setLedger((l) => ({
        ...l,
        transactions: [
          ...l.transactions.map((t) => byId.get(t.id) ?? t),
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
      label: `${source} ${count} ${count === 1 ? "transaction" : "transactions"}`,
      total: count,
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
          const fresh = paired.flatMap((p) => {
            const latest = latestTransaction(p.id);
            if (
              !latest ||
              latest.type === "transfer" ||
              latest.amount !== p.amount ||
              latest.account_id !==
                (latest.type === "expense" ? p.account_id : p.to_account_id)
            )
              return [];
            return [
              {
                ...latest,
                type: "transfer" as const,
                category_id: null,
                account_id: p.account_id,
                to_account_id: p.to_account_id,
              },
            ];
          });
          fresh.forEach((t) => validateTransaction(t, ledgerRef.current));
          if (fresh.length)
            await api.updateTransactions(
              fresh,
              (saved, records) => {
                if (!stillOwner()) return;
                updateTransactions(records);
                ctx.progress(rows.length + saved);
              },
              stillOwner,
            );
          ctx.progress(count);
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
            if (generation.current !== current) return;
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

  return { bulkUpdate, importTransactions, createCategories };
}
