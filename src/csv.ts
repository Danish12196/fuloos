import {
  minor,
  validateTransaction,
  type Ledger,
  type Transaction,
} from "./domain.ts";
export type ImportTransaction = Omit<Transaction, "id">;
export interface CsvOptions {
  transfers?: Record<number, string>;
  date: number;
  payee: number;
  notes: number;
  category: number;
  amount: number;
  debit: number;
  credit: number;
  split: boolean;
  flip: boolean;
  decimal: "." | ",";
  dateFormat: "DMY" | "MDY" | "YMD";
  account: string;
}
export function parseCsv(
  text: string,
  delimiter = ",",
  options?: { limit?: number },
): string[][] {
  const limit = options?.limit;
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === delimiter || c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (c !== delimiter) {
        if (row.some((v) => v.trim())) {
          rows.push(row);
          if (limit === undefined && rows.length > 10001)
            throw new Error("Import at most 10,000 rows at a time.");
          if (limit !== undefined && rows.length >= limit) return rows;
        }
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"')
        throw new Error("Invalid CSV quoting. Check the delimiter.");
      field += c;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some((v) => v.trim())) {
    rows.push(row);
    if (limit === undefined && rows.length > 10001)
      throw new Error("Import at most 10,000 rows at a time.");
  }
  return rows;
}
export function csvDate(
  value: string,
  format: CsvOptions["dateFormat"],
): string {
  const parts = value.trim().split(/[\/\-.]/);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p)))
    throw new Error("Date must contain day, month and four-digit year.");
  const [y, m, d] =
    format === "YMD"
      ? parts
      : format === "DMY"
        ? [parts[2], parts[1], parts[0]]
        : [parts[2], parts[0], parts[1]];
  const result = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (
    y.length !== 4 ||
    Number(y) < 1000 ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result
  )
    throw new Error("Invalid calendar date.");
  return result;
}
export function csvAmount(value: string, decimal: "." | ","): number {
  let s = value.trim().replace(/\s/g, "");
  const parentheses = /^\(.*\)$/.test(s);
  if (parentheses) s = "-" + s.slice(1, -1);
  const pattern =
    decimal === "."
      ? /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/
      : /^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  if (!pattern.test(s)) throw new Error("Invalid amount or decimal separator.");
  return minor(
    decimal === "."
      ? s.replace(/,/g, "")
      : s.replace(/\./g, "").replace(",", "."),
  );
}
export function transactionKey(t: ImportTransaction): string {
  return JSON.stringify([
    t.account_id,
    t.date,
    t.type,
    t.to_account_id,
    t.amount,
    t.payee.trim().toLowerCase().replace(/\s+/g, " "),
  ]);
}
export function previewCsv(
  rows: string[][],
  options: CsvOptions,
  ledger: Ledger,
) {
  const seen = new Set(ledger.transactions.map(transactionKey));
  return rows.map((row, index) => {
    try {
      const get = (i: number) => (i < 0 ? "" : (row[i] ?? "").trim());
      if (
        options.date < 0 ||
        (options.split
          ? options.debit < 0 ||
            options.credit < 0 ||
            options.debit === options.credit
          : options.amount < 0)
      )
        throw new Error("Map the date and amount columns.");
      let signed: number;
      if (options.split) {
        const debit = get(options.debit)
          ? csvAmount(get(options.debit), options.decimal)
          : 0;
        const credit = get(options.credit)
          ? csvAmount(get(options.credit), options.decimal)
          : 0;
        if (debit < 0 || credit < 0 || (debit && credit))
          throw new Error("Use a positive debit or credit, not both.");
        signed = credit - debit;
      } else signed = csvAmount(get(options.amount), options.decimal);
      if (options.flip) signed *= -1;
      const categoryName = get(options.category);
      const category = ledger.categories.find(
        (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
      );
      const otherAccount = options.transfers?.[index];
      if (!otherAccount && categoryName && !category)
        throw new Error(
          `Unknown category: ${categoryName}. Create it first or leave Category unmapped.`,
        );
      const transaction: ImportTransaction = {
        date: csvDate(get(options.date), options.dateFormat),
        account_id: otherAccount && signed > 0 ? otherAccount : options.account,
        to_account_id: otherAccount
          ? signed > 0
            ? options.account
            : otherAccount
          : null,
        category_id: otherAccount ? null : (category?.id ?? null),
        type: otherAccount ? "transfer" : signed < 0 ? "expense" : "income",
        amount: Math.abs(signed),
        payee: get(options.payee),
        notes: get(options.notes),
      };
      validateTransaction(transaction, ledger);
      const key = transactionKey(transaction),
        duplicate = seen.has(key);
      seen.add(key);
      return { index, transaction, duplicate, error: "" };
    } catch (e) {
      return {
        index,
        transaction: null,
        duplicate: false,
        error: e instanceof Error ? e.message : "Invalid row",
      };
    }
  });
}
