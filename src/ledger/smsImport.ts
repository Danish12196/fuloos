/* Turns bank SMS into reviewable Fuloos transactions. Everything here runs in the browser; only the transactions the
   user confirms are saved, and the SMS text itself is never stored. */
import { validateTransaction, type Ledger } from "../domain.ts";
import { transactionKey, type ImportTransaction } from "../csv.ts";
import { categorise, type CategorySuggestion } from "./categoriser.ts";
import type { LoadedModel } from "./model.ts";
import type { CategoryMap } from "./mapping.ts";
import {
  bankForMessage,
  bankFromSender,
  detectBank,
  maskForDisplay,
  parseSms,
  type ParsedSms,
  type RawSms,
  type SmsType,
} from "./sms.ts";

export interface SmsImportOptions {
  account: string;
  /** Used when neither the SMS text nor the backup file has a date. */
  fallbackDate: string;
  /** Force a bank for every message (otherwise sender, then templates, decide). */
  bank?: string | null;
}

export interface SmsPreviewRow {
  index: number;
  display: string;
  parsed: ParsedSms | null;
  transaction: ImportTransaction | null;
  dateSource: "sms" | "backup" | "fallback" | null;
  suggestion: CategorySuggestion | null;
  duplicate: boolean;
  /** Rows the user would normally not import (OTPs, internal moves, card repayments). */
  skipped: string;
  error: string;
}

const SKIP: Partial<Record<SmsType, string>> = {
  otp: "One-time password, not a transaction.",
  declined: "Declined or failed transaction.",
  notice: "Not a recognised transaction message.",
  internal_out: "Move between your own accounts at the same bank.",
  internal_in: "Move between your own accounts at the same bank.",
  card_repayment: "Credit card repayment: record it as a transfer.",
  card_payment_received: "Credit card repayment: record it as a transfer.",
};

const PAYEE_FOR_TYPE: Partial<Record<SmsType, string>> = {
  cash_withdrawal: "Cash withdrawal",
  bank_fee: "Bank fee",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  income: "Salary / income",
  loan_repayment: "Loan instalment",
  other_debit: "Bank debit",
  refund: "Refund",
};

/** Title-case shouty merchant strings ("AL MAYA SUPERMARKET" -> "Al Maya Supermarket"); brand names stay as they are. */
export function displayPayee(merchant: string | null): string {
  if (!merchant || merchant === "UNKNOWN MERCHANT") return "";
  if (merchant !== merchant.toUpperCase()) return merchant;
  return merchant
    .toLowerCase()
    .replace(
      /(^|[\s&(\-/.])([a-z])/g,
      (_, p: string, c: string) => p + c.toUpperCase(),
    );
}

export function previewSms(
  messages: RawSms[],
  options: SmsImportOptions,
  ledger: Ledger,
  model: LoadedModel | null,
  map: CategoryMap,
): SmsPreviewRow[] {
  const seen = new Set(ledger.transactions.map(transactionKey));
  const seenText = new Set<string>();
  const batchBank =
    options.bank ??
    detectBank(
      messages.filter((m) => !bankFromSender(m.sender)).map((m) => m.message),
    );
  return messages.map((raw, index) => {
    const row: SmsPreviewRow = {
      index,
      display: maskForDisplay(raw.message),
      parsed: null,
      transaction: null,
      dateSource: null,
      suggestion: null,
      duplicate: false,
      skipped: "",
      error: "",
    };
    try {
      const bank =
        options.bank ??
        bankFromSender(raw.sender) ??
        bankForMessage(raw.message, batchBank);
      const parsed = parseSms(raw.message, bank);
      row.parsed = parsed;
      const textKey = `${bank}\u0001${raw.message.trim()}`;
      const repeatedSms = seenText.has(textKey);
      seenText.add(textKey);
      if (SKIP[parsed.txn_type]) {
        row.skipped = SKIP[parsed.txn_type]!;
        if (parsed.txn_type === "notice" && !bank)
          row.skipped = "Bank not recognised. Choose the bank above.";
        return row;
      }
      if (parsed.direction === "none")
        throw new Error("Not a debit or credit.");
      if (!Number.isFinite(parsed.amount_aed)) {
        throw new Error(
          parsed.currency
            ? `Currency ${parsed.currency} is not supported yet.`
            : "Amount not found in this SMS.",
        );
      }
      const date = parsed.date_in_text ?? raw.date ?? options.fallbackDate;
      row.dateSource = parsed.date_in_text
        ? "sms"
        : raw.date
          ? "backup"
          : "fallback";
      const type = parsed.direction === "debit" ? "expense" : "income";
      let category_id: string | null = null;
      if (type === "expense") {
        row.suggestion = categorise(
          model,
          parsed.merchant_clean,
          parsed.amount_aed,
        );
        category_id = row.suggestion.category
          ? (map[row.suggestion.category] ?? null)
          : null;
      }
      const foreign =
        parsed.currency && parsed.currency !== "AED"
          ? ` · ${parsed.amount.toFixed(2)} ${parsed.currency} at a fixed reference rate`
          : "";
      const transaction: ImportTransaction = {
        date,
        account_id: options.account,
        to_account_id: null,
        category_id,
        type,
        amount: Math.round(parsed.amount_aed * 100),
        payee:
          displayPayee(parsed.merchant_clean) ||
          PAYEE_FOR_TYPE[parsed.txn_type] ||
          "",
        notes: `From ${bank ?? "bank"} SMS${foreign}`,
      };
      validateTransaction(transaction, ledger);
      const key = transactionKey(transaction);
      row.duplicate = repeatedSms || seen.has(key);
      seen.add(key);
      row.transaction = transaction;
    } catch (e) {
      row.error = e instanceof Error ? e.message : "Could not read this SMS.";
    }
    return row;
  });
}
