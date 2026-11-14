import { validateSplits, validateTags } from "./enrichment.ts";

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
export interface TransactionSplit {
  category_id: string | null;
  amount: number;
  notes?: string;
}
export type RuleMatchField = "payee" | "notes" | "either";
export type RuleMatchType = "contains" | "starts_with" | "exact" | "regex";
export interface TransactionRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match_field: RuleMatchField;
  match_type: RuleMatchType;
  pattern: string;
  min_amount?: number | null;
  max_amount?: number | null;
  set_category_id?: string | null;
  add_tags?: string[];
  set_payee?: string;
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
  tags?: string[];
  splits?: TransactionSplit[];
  receipt?: string;
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
export interface Budget {
  id: string;
  category_id: string;
  amount: number;
  start_month: string;
  end_month: string | null;
}
export type GoalKind = "savings" | "sinking_fund";
export type GoalStatus = "active" | "completed" | "paused";
export interface SavingsGoal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  account_id: string | null;
  color: string;
  emoji?: string;
  kind: GoalKind;
  status: GoalStatus;
  notes: string;
}
export interface GoalContribution {
  id: string;
  goal_id: string;
  amount: number;
  date: string;
  transaction_id: string | null;
  notes: string;
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
export type DigestDay =
  | "sun"
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat";
export interface NotificationPreferences {
  id?: string;
  email_enabled: boolean;
  upcoming_bill_enabled: boolean;
  upcoming_bill_days: number;
  overdue_enabled: boolean;
  budget_80_enabled: boolean;
  budget_100_enabled: boolean;
  weekly_digest_enabled: boolean;
  digest_day: DigestDay;
  timezone: string;
  channels?: Record<string, boolean>;
}
export const defaultNotificationPreferences: NotificationPreferences = {
  email_enabled: false,
  upcoming_bill_enabled: false,
  upcoming_bill_days: 3,
  overdue_enabled: false,
  budget_80_enabled: false,
  budget_100_enabled: false,
  weekly_digest_enabled: false,
  digest_day: "sun",
  timezone: "Asia/Dubai",
  channels: { email: false },
};
export type CaptureAlertSource = "email" | "shortcut";
export type CaptureAlertType = "expense" | "income" | "unknown";
export type CaptureAlertStatus = "pending" | "imported" | "dismissed";
export interface CaptureTokenInfo {
  id: string;
  token_preview: string;
  enabled: boolean;
  default_account_id: string | null;
}
export interface CapturedAlert {
  id: string;
  source: CaptureAlertSource;
  subject: string;
  raw_text: string;
  parsed_type: CaptureAlertType;
  parsed_amount: number;
  parsed_date: string;
  parsed_payee: string;
  parsed_notes: string;
  account_hint: string;
  status: CaptureAlertStatus;
  created_at_iso: string;
}
export interface Ledger {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurring?: RecurringSchedule[];
  recurring_occurrences?: RecurringOccurrenceRecord[];
  recurring_prefs?: RecurringPreferences;
  budgets?: Budget[];
  goals?: SavingsGoal[];
  goal_contributions?: GoalContribution[];
  rules?: TransactionRule[];
  captured_alerts?: CapturedAlert[];
}
export const emptyLedger: Ledger = {
  accounts: [],
  categories: [],
  transactions: [],
  recurring: [],
  recurring_occurrences: [],
  recurring_prefs: defaultRecurringPreferences,
  budgets: [],
  goals: [],
  goal_contributions: [],
  rules: [],
  captured_alerts: [],
};
export function minor(value: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a valid amount with up to two decimal places.");
  const negative = value.trim().startsWith("-");
  const [whole, part = ""] = value.trim().replace("-", "").split(".");
  const result = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || Math.abs(result) > 100_000_000_000)
    throw new Error("Amount is too large.");
  return result === 0 ? 0 : negative ? -result : result;
}
export const money = (amount: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    amount / 100,
  );
/**
 * An account's stored opening_balance is its balance at the start of
 * opening_date, before that day's transactions. The form shows this as
 * "balance at the end of <opening_date - 1>". Transactions on either side of
 * that date are allowed: later ones move the balance forward, earlier ones are
 * already part of it and only change the history before it.
 */
export const NO_BALANCE_DATE = "1970-01-01";
/** True when the user gave a balance; false when it is just the sum of transactions. */
export function hasBalanceAnchor(account: Account): boolean {
  return !(
    account.opening_balance === 0 && account.opening_date <= NO_BALANCE_DATE
  );
}
export function addDaysIso(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** The day whose closing balance the account's anchor records. */
export const balanceAsOfDate = (account: Account) =>
  addDaysIso(account.opening_date, -1);
/** Stored opening_date for a balance at the end of `asOf`. */
export const openingDateFor = (asOf: string) => addDaysIso(asOf, 1);
/** How much a transaction moves one account's balance, in fils. */
export function accountDelta(t: Transaction, accountId: string): number {
  return (
    (t.to_account_id === accountId ? t.amount : 0) +
    (t.account_id === accountId
      ? t.type === "income"
        ? t.amount
        : -t.amount
      : 0)
  );
}
/** The account's balance before its earliest transaction. Running balances start here. */
export function startingBalance(
  account: Account,
  transactions: Transaction[],
): number {
  return transactions.reduce(
    (sum, t) =>
      t.date < account.opening_date ? sum - accountDelta(t, account.id) : sum,
    account.opening_balance,
  );
}
/** The balance after every transaction, including future-dated ones. */
export function balance(account: Account, transactions: Transaction[]): number {
  return transactions.reduce(
    (sum, t) =>
      t.date >= account.opening_date ? sum + accountDelta(t, account.id) : sum,
    account.opening_balance,
  );
}
export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + "T00:00:00Z");
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
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
  if (t.type === "transfer") {
    const target = ledger.accounts.find((a) => a.id === t.to_account_id);
    if (!target || target.id === source.id)
      throw new Error("Choose two different accounts.");
    if (t.category_id) throw new Error("Transfers do not have a category.");
  } else {
    if (t.to_account_id)
      throw new Error("Only transfers can have a receiving account.");
    if (t.category_id && !ledger.categories.some((c) => c.id === t.category_id))
      throw new Error("Choose an existing category.");
  }
  if (t.tags !== undefined) {
    validateTags(t.tags);
  }
  if (t.splits !== undefined) {
    validateSplits(t.splits, t.amount, t.type, ledger.categories);
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
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
