export type AccountType =
  | "current"
  | "savings"
  | "credit_card"
  | "cash"
  | "other";
export type Kind = "expense" | "income" | "transfer";
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  opening_balance: number;
  opening_date: string;
  color: string;
}
export interface Category {
  id: string;
  name: string;
  type: "expense" | "income";
  description: string;
  color: string;
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
export interface Ledger {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}
export const emptyLedger: Ledger = {
  accounts: [],
  categories: [],
  transactions: [],
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
export function validateTransaction(
  t: Omit<Transaction, "id">,
  ledger: Ledger,
): void {
  if (
    !Number.isSafeInteger(t.amount) ||
    t.amount <= 0 ||
    t.amount > 100_000_000_000
  )
    throw new Error(
      "Amount must be greater than zero and within the supported limit.",
    );
  const source = ledger.accounts.find((a) => a.id === t.account_id);
  if (!source) throw new Error("Select an account.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || Number.isNaN(Date.parse(t.date)))
    throw new Error("Choose a valid date.");
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
    if (
      t.category_id &&
      !ledger.categories.some(
        (c) => c.id === t.category_id && c.type === t.type,
      )
    )
      throw new Error("Choose a matching category.");
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
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
