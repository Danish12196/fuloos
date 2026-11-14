import {
  isIsoCalendarDate,
  minor,
  today,
  validateTransaction,
  type Account,
  type Ledger,
  type Transaction,
} from "./domain.ts";

export type QuickAddKind = "expense" | "income";

export interface QuickAddDraft {
  type: QuickAddKind;
  amount: string;
  accountId: string;
  categoryId: string;
  payee: string;
  date: string;
}

export const LAST_ACCOUNT_KEY = "fuloos_quick_add_account";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis !== "undefined" && "localStorage" in globalThis
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

export function readRememberedAccount(
  storage: StorageLike | null = defaultStorage(),
): string | null {
  try {
    return storage?.getItem(LAST_ACCOUNT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveRememberedAccount(
  accountId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!accountId) return;
  try {
    storage?.setItem(LAST_ACCOUNT_KEY, accountId);
  } catch {
    // Ignore storage quota or private-mode errors.
  }
}

export function pickDefaultAccountId(
  accounts: readonly Account[],
  rememberedId: string | null | undefined,
): string {
  if (rememberedId && accounts.some((a) => a.id === rememberedId)) {
    return rememberedId;
  }
  return accounts[0]?.id ?? "";
}

function extractIsoDate(text: string): string | undefined {
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch && isIsoCalendarDate(isoMatch[1])) return isoMatch[1];

  const dmyMatch = text.match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/);
  if (dmyMatch) {
    const candidate = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    if (isIsoCalendarDate(candidate)) return candidate;
  }
  return undefined;
}

function extractAmount(text: string): string | undefined {
  // Prefer explicit AED / Dhs currency patterns first.
  const currencyFirst = text.match(
    /(?:AED|Dhs\.?|د\.إ)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
  );
  if (currencyFirst) {
    return currencyFirst[1].replace(/,/g, "");
  }

  const currencyAfter = text.match(
    /\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:AED|Dhs\.?)\b/i,
  );
  if (currencyAfter) {
    return currencyAfter[1].replace(/,/g, "");
  }

  // Fallback: standalone decimal number (avoid matching dates or masked card digits).
  const stripped = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{2}[/-]\d{2}[/-]\d{4}\b/g, " ")
    .replace(/[X*]{2,}\d{2,4}/gi, " ");
  const decimalMatch = stripped.match(/\b([0-9][0-9,]*\.\d{1,2})\b/);
  if (decimalMatch) return decimalMatch[1].replace(/,/g, "");

  const intMatch = stripped.match(/\b([1-9][0-9,]{0,6})\b/);
  if (intMatch) return intMatch[1].replace(/,/g, "");

  return undefined;
}

function extractPayee(text: string, title?: string): string {
  const atMatch = text.match(
    /\b(?:at|to|from|merchant)\s+([A-Za-z0-9&'.\- ]{2,60}?)(?=\s+(?:on|for|via|using|with|AED|Dhs|\d{4}-\d{2}-\d{2})\b|[.,;\n\r]|$)/i,
  );
  if (atMatch) {
    return atMatch[1].trim().slice(0, 80);
  }

  const cleanTitle = (title ?? "").trim();
  if (
    cleanTitle &&
    !/^(share|shared|receipt|transaction|fuloos)$/i.test(cleanTitle)
  ) {
    return cleanTitle.slice(0, 80);
  }

  // Strip currency/amount/date tokens to leave a readable merchant phrase.
  const cleaned = text
    .replace(/(?:AED|Dhs\.?|د\.إ)\s*[0-9][0-9,]*(?:\.\d{1,2})?/gi, " ")
    .replace(/\b[0-9][0-9,]*(?:\.\d{1,2})?\s*(?:AED|Dhs\.?)\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{2}[/-]\d{2}[/-]\d{4}\b/g, " ")
    .replace(/\b[0-9][0-9,]*(?:\.\d{1,2})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80);
}

/**
 * Best-effort parser for Web Share Target text (e.g. bank SMS or receipt snippet)
 * to prefill the Quick-Add transaction modal.
 */
export function parseSharedTransactionText(
  text: string,
  title?: string,
  defaultDate: string = today(),
): Partial<QuickAddDraft> {
  const rawText = [title, text].filter((s) => s && s.trim()).join(" ").trim();
  if (!rawText) return {};

  const isIncome =
    /\b(credited|salary|refund|received|deposit(?:ed)?|cashback)\b/i.test(
      rawText,
    ) && !/\bcredit\s+card\b/i.test(rawText);

  const amount = extractAmount(rawText);
  const date = extractIsoDate(rawText) ?? defaultDate;
  const payee = extractPayee(text.trim() || rawText, title);

  const result: Partial<QuickAddDraft> = {
    type: isIncome ? "income" : "expense",
    date,
  };
  if (amount) result.amount = amount;
  if (payee) result.payee = payee;
  return result;
}

/**
 * Parses `window.location.search` for `?quickadd=1` deep links and
 * Web Share Target parameters (`?title=...&text=...&url=...`).
 */
export function parseQuickAddUrl(
  search: string,
  defaultDate: string = today(),
): { open: boolean; draft: Partial<QuickAddDraft> } {
  const params = new URLSearchParams(search);
  const quickadd = params.get("quickadd");
  const title = params.get("title") ?? "";
  const text = params.get("text") ?? "";
  const url = params.get("url") ?? "";
  const hasShare = Boolean(title.trim() || text.trim() || url.trim());

  const open = quickadd === "1" || quickadd === "true" || hasShare;
  if (!open) return { open: false, draft: {} };

  const shared = hasShare
    ? parseSharedTransactionText(
        [text, url].filter(Boolean).join(" "),
        title,
        defaultDate,
      )
    : {};

  const draft: Partial<QuickAddDraft> = { ...shared };
  const typeParam = params.get("type");
  if (typeParam === "expense" || typeParam === "income") {
    draft.type = typeParam;
  }
  const amountParam = params.get("amount")?.trim();
  if (amountParam && /^\d+(?:\.\d{1,2})?$/.test(amountParam)) {
    draft.amount = amountParam;
  }
  const payeeParam = params.get("payee")?.trim();
  if (payeeParam) {
    draft.payee = payeeParam.slice(0, 80);
  }
  const dateParam = params.get("date")?.trim();
  if (dateParam && isIsoCalendarDate(dateParam)) {
    draft.date = dateParam;
  }

  return { open: true, draft };
}

/**
 * Validates and builds an integer-fils transaction payload from Quick-Add fields.
 */
export function buildQuickAddTransaction(
  draft: QuickAddDraft,
  ledger: Ledger,
): Omit<Transaction, "id"> {
  const amountText = draft.amount.trim();
  if (!amountText) throw new Error("Enter an amount.");
  const amount = minor(amountText);
  if (amount <= 0) throw new Error("Enter an amount greater than zero.");

  const record: Omit<Transaction, "id"> = {
    type: draft.type,
    amount,
    account_id: draft.accountId,
    to_account_id: null,
    category_id: draft.categoryId || null,
    date: draft.date,
    payee: draft.payee.trim().slice(0, 120),
    notes: "",
  };
  validateTransaction(record, ledger);
  return record;
}
