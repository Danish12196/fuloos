import type {
  Category,
  Kind,
  Ledger,
  Transaction,
  TransactionSplit,
} from "./domain.ts";

export const MAX_TAGS_PER_TX = 20;
export const MAX_TAG_LENGTH = 32;
export const MAX_SPLITS_PER_TX = 50;
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_RECEIPT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** Normalizes a single tag: trimmed, collapsed whitespace, lowercase. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Normalizes a tag list (array or comma-separated string) into unique
 * lowercase tags, capped at MAX_TAGS_PER_TX and MAX_TAG_LENGTH.
 */
export function normalizeTags(raw: unknown): string[] {
  const parts: string[] = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const tag = normalizeTag(part).slice(0, MAX_TAG_LENGTH).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_TX) break;
  }
  return out;
}

/** Validates tags on a transaction or rule, returning normalized tags or throwing. */
export function validateTags(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("Tags must be a list of strings.");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new Error("Each tag must be text.");
    }
    const tag = normalizeTag(item);
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new Error(
        `Tag "${tag.slice(0, 16)}…" exceeds ${MAX_TAG_LENGTH} characters.`,
      );
    }
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  if (out.length > MAX_TAGS_PER_TX) {
    throw new Error(`A transaction can have at most ${MAX_TAGS_PER_TX} tags.`);
  }
  return out;
}

/** Normalizes raw splits from storage or form state. */
export function normalizeSplits(raw: unknown): TransactionSplit[] {
  if (!Array.isArray(raw)) return [];
  const out: TransactionSplit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const amount = Number(rec.amount);
    const categoryId =
      typeof rec.category_id === "string" && rec.category_id.trim()
        ? rec.category_id.trim()
        : null;
    const notes =
      typeof rec.notes === "string" && rec.notes.trim()
        ? rec.notes.trim().slice(0, 200)
        : undefined;
    out.push({
      category_id: categoryId,
      amount: Number.isFinite(amount) ? Math.trunc(amount) : 0,
      ...(notes ? { notes } : {}),
    });
  }
  return out;
}

/** Returns remaining fils needed for splits to match txAmount. */
export function splitRemainder(
  txAmount: number,
  splits: ReadonlyArray<Pick<TransactionSplit, "amount">>,
): number {
  const sum = splits.reduce((s, item) => s + (item.amount || 0), 0);
  return txAmount - sum;
}

/** Validates split lines against transaction amount, type, and user categories. */
export function validateSplits(
  splits: TransactionSplit[] | undefined,
  txAmount: number,
  txType: Kind,
  categories: ReadonlyArray<Category>,
): void {
  if (!splits || splits.length === 0) return;
  if (txType === "transfer") {
    throw new Error("Transfers cannot be split.");
  }
  if (splits.length > MAX_SPLITS_PER_TX) {
    throw new Error(
      `A transaction can have at most ${MAX_SPLITS_PER_TX} split lines.`,
    );
  }
  const catIds = new Set(categories.map((c) => c.id));
  let sum = 0;
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    if (!Number.isSafeInteger(s.amount) || s.amount <= 0) {
      throw new Error(
        `Split #${i + 1} must have a positive amount greater than zero.`,
      );
    }
    if (s.category_id && !catIds.has(s.category_id)) {
      throw new Error(`Split #${i + 1} references a missing category.`);
    }
    if (s.notes && s.notes.length > 200) {
      throw new Error(`Split #${i + 1} notes must be 200 characters or fewer.`);
    }
    sum += s.amount;
  }
  if (sum !== txAmount) {
    throw new Error("Split amounts must sum to the transaction amount.");
  }
}

/**
 * Returns the category-level amount breakdown for a transaction.
 * For split transactions, each split attributes its amount to its category_id.
 * For non-split transactions, attributes the full amount to t.category_id.
 */
export function transactionCategoryAmounts(
  t: Pick<Transaction, "type" | "amount" | "category_id" | "splits">,
): Array<{ category_id: string | null; amount: number }> {
  if (t.type === "transfer") return [];
  if (t.splits && t.splits.length > 0) {
    return t.splits.map((s) => ({
      category_id: s.category_id ?? null,
      amount: s.amount,
    }));
  }
  return [{ category_id: t.category_id ?? null, amount: t.amount }];
}

/** Collects all unique sorted tags used across a ledger's transactions. */
export function collectLedgerTags(ledger: Pick<Ledger, "transactions">): string[] {
  const set = new Set<string>();
  for (const t of ledger.transactions) {
    for (const tag of t.tags ?? []) {
      const n = normalizeTag(tag);
      if (n) set.add(n);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Validates a receipt file before upload (size <= 5 MB, allowed MIME type). */
export function validateReceiptFile(file: {
  size: number;
  type: string;
  name?: string;
}): void {
  if (
    !ALLOWED_RECEIPT_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_RECEIPT_MIME_TYPES)[number],
    )
  ) {
    throw new Error(
      "Receipt must be a JPEG, PNG, WebP image, or PDF document.",
    );
  }
  if (file.size <= 0) {
    throw new Error("Receipt file is empty.");
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error("Receipt file must be 5 MB or smaller.");
  }
}

export function isReceiptPdf(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}
