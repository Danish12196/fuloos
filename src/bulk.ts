import {
  validateTransaction,
  type Kind,
  type Ledger,
  type Transaction,
} from "./domain.ts";

export interface BulkChanges {
  type?: Kind;
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

