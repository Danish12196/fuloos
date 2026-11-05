export type AccountType =
  | "current"
  | "savings"
  | "credit_card"
  | "cash"
  | "other";
export type Kind = "expense" | "income" | "transfer";
export type RecurringKind = "expense" | "income";
export type RecurringFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";
export type RecurringAmountType = "fixed" | "variable";
export type RecurringStatus = "active" | "paused";
export type OccurrenceMatchSource = "manual" | "auto";
export type AutoDetectSetting = "on" | "off";
export type AutoMatchSetting = "auto" | "review" | "off";
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  opening_balance: number;
  opening_date: string;
  color: string;
  emoji?: string;
}
export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  emoji?: string;
}
export interface Transaction {
  id: string;
  type: Kind;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  date: string;
  payee: string;
  notes: string;
}
export interface RecurringSchedule {
  id: string;
  name: string;
  type: RecurringKind;
  amount: number;
  amount_type: RecurringAmountType;
  account_id: string;
  category_id: string | null;
  frequency: RecurringFrequency;
  start_date: string;
  end_date: string | null;
  status: RecurringStatus;
  notes: string;
}
export interface RecurringOccurrenceRecord {
  id: string;
  recurring_id: string;
  occurrence_date: string;
  transaction_id: string;
  match_source?: OccurrenceMatchSource;
  match_reason?: string;
}
export interface RecurringPreferences {
  id?: string;
  auto_detect: AutoDetectSetting;
  auto_match: AutoMatchSetting;
  dismissed_keys: string[];
}
export const defaultRecurringPreferences: RecurringPreferences = {
  auto_detect: "on",
  auto_match: "auto",
  dismissed_keys: [],
};
export interface Ledger {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurring?: RecurringSchedule[];
  recurring_occurrences?: RecurringOccurrenceRecord[];
  recurring_prefs?: RecurringPreferences;
}
export const emptyLedger: Ledger = {
  accounts: [],
  categories: [],
  transactions: [],
  recurring: [],
  recurring_occurrences: [],
  recurring_prefs: defaultRecurringPreferences,
};
export function minor(value: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a valid amount with up to two decimal places.");
  const negative = value.trim().startsWith("-");
  const [whole, part = ""] = value.trim().replace("-", "").split(".");
  const result = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || Math.abs(result) > 100_000_000_000)
    throw new Error("Amount is too large.");
  return negative ? -result : result;
}
export const money = (amount: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    amount / 100,
  );
export function balance(account: Account, transactions: Transaction[]): number {
  return transactions.reduce(
    (sum, t) =>
      sum +
      (t.to_account_id === account.id ? t.amount : 0) +
      (t.account_id === account.id
        ? t.type === "income"
          ? t.amount
          : -t.amount
        : 0),
    account.opening_balance,
  );
}
export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + "T00:00:00Z");
  return (
    !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value
  );
}
export function validateTransaction(
  t: Omit<Transaction, "id"> & { id?: string },
  ledger: Ledger,
): void {
  if (
    !Number.isSafeInteger(t.amount) ||
    t.amount < 0 ||
    t.amount > 100_000_000_000
  )
    throw new Error(
      "Amount must be zero or greater and within the supported limit.",
    );
  const source = ledger.accounts.find((a) => a.id === t.account_id);
  if (!source) throw new Error("Select an account.");
  if (!isIsoCalendarDate(t.date)) throw new Error("Choose a valid date.");
  if (t.date < source.opening_date)
    throw new Error("Transaction cannot be before the account opening date.");
  if (t.type === "transfer") {
    const target = ledger.accounts.find((a) => a.id === t.to_account_id);
    if (!target || target.id === source.id)
      throw new Error("Choose two different accounts.");
    if (t.date < target.opening_date)
      throw new Error(
        "Transaction cannot be before the receiving account opening date.",
      );
    if (t.category_id) throw new Error("Transfers do not have a category.");
  } else {
    if (t.to_account_id)
      throw new Error("Only transfers can have a receiving account.");
    if (t.category_id && !ledger.categories.some((c) => c.id === t.category_id))
      throw new Error("Choose an existing category.");
  }
  if (t.id && ledger.recurring_occurrences?.length) {
    const link = ledger.recurring_occurrences.find(
      (o) => o.transaction_id === t.id,
    );
    if (link) {
      const schedule = ledger.recurring?.find(
        (r) => r.id === link.recurring_id,
      );
      if (schedule && schedule.type !== t.type)
        throw new Error(
          "Unlink recurring occurrence before changing transaction type.",
        );
    }
  }
}
export function totals(transactions: Transaction[]) {
  return transactions.reduce(
    (a, t) => ({
      income: a.income + (t.type === "income" ? t.amount : 0),
      expense: a.expense + (t.type === "expense" ? t.amount : 0),
    }),
    { income: 0, expense: 0 },
  );
}
export function errorMessage(e: unknown): string {
  return e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Something went wrong. Please try again.";
}
export function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
export const uaeToday = (at: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
export const today = () => uaeToday();
