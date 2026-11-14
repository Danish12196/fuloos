import type { ImportTransaction } from "./csv.ts";
import {
  uaeToday,
  validateTransaction,
  type Account,
  type CaptureAlertSource,
  type CapturedAlert,
  type Ledger,
} from "./domain.ts";
import type { UserSuggestion } from "./ledger/learning.ts";
import {
  bankForMessage,
  cleanName,
  dateInText,
  detectBank,
  parseSms,
} from "./ledger/sms.ts";
import { displayPayee } from "./ledger/smsImport.ts";
import { applyRules } from "./rules.ts";

export function pendingCapturedAlerts(
  alerts: readonly CapturedAlert[] | undefined,
): CapturedAlert[] {
  if (!alerts?.length) return [];
  return alerts
    .filter((a) => a.status === "pending")
    .slice()
    .sort((a, b) => b.created_at_iso.localeCompare(a.created_at_iso));
}

export function matchAccountHint(
  hint: string,
  accounts: readonly Account[],
  defaultAccountId?: string | null,
): string {
  if (!accounts.length) return "";
  const normHint = hint.toLowerCase().trim();
  if (normHint) {
    const digits = /\b(\d{4})\b/.exec(normHint)?.[1];
    if (digits) {
      const byDigits = accounts.find((a) => a.name.includes(digits));
      if (byDigits) return byDigits.id;
    }
    const tokens = normHint
      .split(/[\s·\-_/]+/)
      .filter((t) => t.length >= 3 && t !== "card");
    for (const tok of tokens) {
      const byName = accounts.find((a) =>
        a.name.toLowerCase().includes(tok),
      );
      if (byName) return byName.id;
    }
  }
  if (defaultAccountId && accounts.some((a) => a.id === defaultAccountId)) {
    return defaultAccountId;
  }
  return accounts[0].id;
}

/** Parse a clipboard/share-sheet UAE bank alert text into an unsaved CapturedAlert draft. */
export function parseClipboardOrShareAlert(
  rawText: string,
  options: {
    source?: CaptureAlertSource;
    subject?: string;
    fallbackDate?: string;
  } = {},
): Omit<CapturedAlert, "id"> {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("Paste or copy a bank alert first.");

  const fallbackDate = options.fallbackDate || uaeToday();
  const batchBank = detectBank([text]);
  const bank = bankForMessage(text, batchBank);
  const parsed = parseSms(text, bank);
  const parsedDate = parsed.date_in_text || dateInText(text) || fallbackDate;

  let parsedType: CapturedAlert["parsed_type"] = "unknown";
  if (parsed.direction === "debit") parsedType = "expense";
  else if (parsed.direction === "credit") parsedType = "income";

  let parsedAmount = Number.isFinite(parsed.amount_aed)
    ? Math.max(0, Math.round(parsed.amount_aed * 100))
    : 0;

  let parsedPayee =
    displayPayee(parsed.merchant_clean) ||
    displayPayee(cleanName(parsed.merchant)) ||
    "";

  // Fallback for ENBD / generic alerts not matched by sms.ts rules
  if (parsedType === "unknown" || parsedAmount === 0) {
    const amtMatch =
      /\bAED\s*([\d,]+(?:\.\d{1,2})?)\b/i.exec(text) ||
      /\b([\d,]+(?:\.\d{1,2})?)\s*AED\b/i.exec(text);
    if (amtMatch) {
      const val = parseFloat(amtMatch[1].replace(/,/g, ""));
      if (Number.isFinite(val) && val > 0) {
        parsedAmount = Math.round(val * 100);
      }
    }
    if (parsedType === "unknown") {
      if (/\b(?:credited|deposited|salary|refund|received)\b/i.test(text)) {
        parsedType = "income";
      } else if (
        /\b(?:debited|purchase|spent|charged|paid|withdrawal|pos)\b/i.test(text)
      ) {
        parsedType = "expense";
      }
    }
    if (!parsedPayee) {
      const atMatch = /\bat\s+([A-Za-z0-9][A-Za-z0-9\s&*.'-]{1,60}?)(?:\s+on\s+\d|\s*\.|$)/i.exec(
        text.replace(/\n+/g, " "),
      );
      if (atMatch) {
        parsedPayee = displayPayee(cleanName(atMatch[1])) || atMatch[1].trim();
      }
    }
  }

  const cardMatch =
    parsed.card_last4 ||
    /(?:card\s+(?:ending(?:\s+with)?|no\.?|xx+|\*+)\s*|ending\s+)(\d{4})\b/i.exec(
      text,
    )?.[1] ||
    "";
  const detectedBank =
    bank || (/\benbd\b|emirates\s*nbd/i.test(text) ? "ENBD" : null);
  const accountHint = [detectedBank, cardMatch ? `Card ${cardMatch}` : ""]
    .filter(Boolean)
    .join(" · ");

  return {
    source: options.source ?? "shortcut",
    subject: (options.subject ?? "").trim().slice(0, 200),
    raw_text: text.slice(0, 8000),
    parsed_type: parsedType,
    parsed_amount: parsedAmount,
    parsed_date: parsedDate,
    parsed_payee: parsedPayee.slice(0, 120),
    parsed_notes: `Captured ${detectedBank ? `${detectedBank} ` : ""}alert`,
    account_hint: accountHint.slice(0, 64),
    status: "pending",
    created_at_iso: new Date().toISOString(),
  };
}

export interface AlertDraftOverrides {
  account_id?: string;
  category_id?: string | null;
  type?: "expense" | "income";
  amount?: number;
  date?: string;
  payee?: string;
  notes?: string;
}

export function suggestCategoryForAlert(
  alert: CapturedAlert,
  ledger: Ledger,
  suggest?: (merchant: string | null, amountAed: number) => UserSuggestion,
): {
  category_id: string | null;
  payee: string;
  tags: string[];
  suggestion: UserSuggestion | null;
} {
  const cleaned = cleanName(alert.parsed_payee || null);
  let suggestion: UserSuggestion | null = null;
  let category_id: string | null = null;
  let payee = alert.parsed_payee || "";

  if (alert.parsed_type !== "income" && suggest) {
    suggestion = suggest(cleaned, (alert.parsed_amount || 0) / 100);
    if (suggestion.category_id) category_id = suggestion.category_id;
    if (suggestion.payee) payee = suggestion.payee;
  }

  const rules = ledger.rules ?? [];
  let tags: string[] = [];
  if (rules.length) {
    const res = applyRules(
      rules,
      {
        type: alert.parsed_type === "income" ? "income" : "expense",
        amount: alert.parsed_amount || 0,
        category_id,
        payee,
        notes: alert.parsed_notes || "",
      },
      { overwriteCategory: false, overwritePayee: false },
    );
    if (res.matchedRules.length) {
      category_id = res.category_id;
      payee = res.payee;
      tags = res.tags;
    }
  }

  return { category_id, payee, tags, suggestion };
}

export function alertToImportTransaction(
  alert: CapturedAlert,
  ledger: Ledger,
  overrides: AlertDraftOverrides = {},
  suggest?: (merchant: string | null, amountAed: number) => UserSuggestion,
): ImportTransaction {
  const type =
    overrides.type ??
    (alert.parsed_type === "income" ? "income" : "expense");
  const account_id =
    overrides.account_id ||
    matchAccountHint(alert.account_hint, ledger.accounts);
  const amount =
    overrides.amount !== undefined ? overrides.amount : alert.parsed_amount;
  const date = overrides.date || alert.parsed_date || uaeToday();

  const suggested = suggestCategoryForAlert(alert, ledger, suggest);
  const category_id =
    type === "income"
      ? (overrides.category_id ?? null)
      : overrides.category_id !== undefined
        ? overrides.category_id
        : suggested.category_id;
  const payee = (overrides.payee ?? suggested.payee ?? "").trim();
  const notes = (overrides.notes ?? alert.parsed_notes ?? "").trim();

  if (amount <= 0) {
    throw new Error("Enter an amount greater than 0 before importing.");
  }

  const tx: ImportTransaction = {
    date,
    account_id,
    to_account_id: null,
    category_id,
    type,
    amount,
    payee,
    notes,
    ...(suggested.tags.length ? { tags: suggested.tags } : {}),
  };
  validateTransaction(tx, ledger);
  return tx;
}

export function buildCaptureWebhookUrl(pbUrl: string): string {
  return `${pbUrl.replace(/\/$/, "")}/api/fuloos/inbound-email`;
}

export function buildShortcutSnippet(webhookUrl: string, token: string): string {
  const t = token || "<YOUR_CAPTURE_TOKEN>";
  return `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${t}","source":"shortcut","text":"Purchase of AED 45.00 with Debit Card ending 1234 at TALABAT, DUBAI."}'`;
}
