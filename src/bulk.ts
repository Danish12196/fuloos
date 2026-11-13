import {
  validateTransaction,
  type Kind,
  type Ledger,
  type Transaction,
} from "./domain.ts";

export interface BulkChanges {
  type?: Kind;
  amount?: number;
  account_id?: string;
  to_account_id?: string;
  category_id?: string | null;
  payee?: string;
  date?: string;
  notes?: { mode: "replace" | "append"; text: string };
}

export function editTransaction(
  t: Transaction,
  changes: BulkChanges,
  ledger: Ledger,
): Transaction {
  const { notes, ...fields } = changes;
  const next = { ...t };
  // A control reset to "keep each" must preserve the row's original value.
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    if (fields[key] !== undefined) Object.assign(next, { [key]: fields[key] });
  }
  if (notes)
    next.notes =
      notes.mode === "append"
        ? [t.notes, notes.text].filter(Boolean).join("\n")
        : notes.text;
  if (next.type === "transfer") {
    if (changes.category_id !== undefined)
      throw new Error(
        "Transfers cannot have a category. Leave category unchanged when converting to transfers.",
      );
    next.category_id = null;
  } else {
    if (changes.to_account_id !== undefined)
      throw new Error("A destination account applies only to transfers.");
    next.to_account_id = null;
  }
  if (next.payee.length > 160)
    throw new Error("Description must be 160 characters or fewer.");
  if (next.notes.length > 1000)
    throw new Error("Notes must be 1,000 characters or fewer.");
  validateTransaction(next, ledger);
  return next;
}

/**
 * Re-apply an edit on top of the newest saved copy of a record. Only fields
 * the user changed (edited differs from original) are taken from `edited`;
 * everything else comes from `latest`, so an earlier queued edit to other
 * fields is not undone by a later one built from an older snapshot.
 */
export function rebaseEdit<T extends object>(
  original: T,
  edited: T,
  latest: T,
): T {
  const next = { ...latest };
  for (const key of Object.keys(edited) as (keyof T)[])
    if (edited[key] !== original[key]) next[key] = edited[key];
  if ("type" in next) {
    const tx = next as Record<string, unknown>;
    if (tx.type === "transfer") {
      tx.category_id = null;
    } else {
      tx.to_account_id = null;
    }
  }
  return next;
}

export type SharedFields = Partial<Omit<Transaction, "id">>;

/**
 * The values every given transaction has in common. A field is present only
 * when all rows agree on it; a missing key means the rows differ ("mixed").
 */
export function sharedFields(items: Transaction[]): SharedFields {
  const shared: SharedFields = {};
  if (!items.length) return shared;
  const keys = [
    "type",
    "amount",
    "account_id",
    "to_account_id",
    "category_id",
    "date",
    "payee",
    "notes",
  ] as const;
  for (const key of keys) {
    const first = items[0][key];
    if (items.every((t) => t[key] === first))
      Object.assign(shared, { [key]: first });
  }
  return shared;
}
