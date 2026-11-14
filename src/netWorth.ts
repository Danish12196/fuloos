import {
  addDaysIso,
  isIsoCalendarDate,
  shiftMonth,
  today,
  type Account,
  type Transaction,
} from "./domain.ts";

export type NetWorthKind = "asset" | "liability";

export type NetWorthAssetCategory =
  | "investment"
  | "gold"
  | "crypto"
  | "property"
  | "vehicle"
  | "other_asset";

export type NetWorthLiabilityCategory =
  | "mortgage"
  | "auto_loan"
  | "personal_loan"
  | "student_loan"
  | "other_liability";

export type NetWorthCategory =
  | NetWorthAssetCategory
  | NetWorthLiabilityCategory;

export interface NetWorthItem {
  id: string;
  name: string;
  kind: NetWorthKind;
  category: NetWorthCategory;
  current_value: number;
  as_of_date: string;
  notes: string;
  color: string;
  emoji?: string;
}

export interface NetWorthSnapshot {
  id: string;
  item_id: string;
  value: number;
  date: string;
  notes: string;
}

export interface NetWorthSummary {
  cashAssets: number;
  accountLiabilities: number;
  trackedAssets: number;
  trackedLiabilities: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface NetWorthSeriesPoint {
  month: string;
  date: string;
  cashAssets: number;
  accountLiabilities: number;
  trackedAssets: number;
  trackedLiabilities: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export const NET_WORTH_ASSET_CATEGORIES: readonly NetWorthAssetCategory[] = [
  "investment",
  "gold",
  "crypto",
  "property",
  "vehicle",
  "other_asset",
];

export const NET_WORTH_LIABILITY_CATEGORIES: readonly NetWorthLiabilityCategory[] =
  [
    "mortgage",
    "auto_loan",
    "personal_loan",
    "student_loan",
    "other_liability",
  ];

export const NET_WORTH_CATEGORIES: Record<
  NetWorthCategory,
  { label: string; kind: NetWorthKind; color: string; emoji: string }
> = {
  investment: {
    label: "Investments & ETFs",
    kind: "asset",
    color: "#1d5b48",
    emoji: "📈",
  },
  gold: {
    label: "Gold & Precious Metals",
    kind: "asset",
    color: "#b08448",
    emoji: "🪙",
  },
  crypto: {
    label: "Crypto",
    kind: "asset",
    color: "#696198",
    emoji: "₿",
  },
  property: {
    label: "Property & Real Estate",
    kind: "asset",
    color: "#619a92",
    emoji: "🏠",
  },
  vehicle: {
    label: "Vehicle",
    kind: "asset",
    color: "#3f7d8b",
    emoji: "🚗",
  },
  other_asset: {
    label: "Other Asset",
    kind: "asset",
    color: "#4a6b5d",
    emoji: "💎",
  },
  mortgage: {
    label: "Mortgage",
    kind: "liability",
    color: "#b3543b",
    emoji: "🏦",
  },
  auto_loan: {
    label: "Auto Loan",
    kind: "liability",
    color: "#c06c4c",
    emoji: "🚘",
  },
  personal_loan: {
    label: "Personal Loan",
    kind: "liability",
    color: "#9a4a5e",
    emoji: "📄",
  },
  student_loan: {
    label: "Student Loan",
    kind: "liability",
    color: "#7f5578",
    emoji: "🎓",
  },
  other_liability: {
    label: "Other Liability",
    kind: "liability",
    color: "#8b5e3c",
    emoji: "🧾",
  },
};

const MAX_VALUE_FILS = 100_000_000_000;

function accountDelta(t: Transaction, accountId: string): number {
  return (
    (t.to_account_id === accountId ? t.amount : 0) +
    (t.account_id === accountId
      ? t.type === "income"
        ? t.amount
        : -t.amount
      : 0)
  );
}

/**
 * Computes an account's closing balance at the end of `asOfDate` (YYYY-MM-DD),
 * anchored at `account.opening_balance` at the start of `account.opening_date`.
 */
export function accountBalanceAsOf(
  account: Account,
  transactions: readonly Transaction[],
  asOfDate: string,
): number {
  if (asOfDate >= account.opening_date) {
    return transactions.reduce(
      (sum, t) =>
        t.date >= account.opening_date && t.date <= asOfDate
          ? sum + accountDelta(t, account.id)
          : sum,
      account.opening_balance,
    );
  }
  return transactions.reduce(
    (sum, t) =>
      t.date > asOfDate && t.date < account.opening_date
        ? sum - accountDelta(t, account.id)
        : sum,
    account.opening_balance,
  );
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

/**
 * Computes the current Net Worth summary across cash/credit accounts and
 * tracked non-cash assets and liabilities as of `asOfDate`.
 */
export function computeNetWorthSummary(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  items: readonly NetWorthItem[],
  asOfDate: string = today(),
): NetWorthSummary {
  let cashAssets = 0;
  let accountLiabilities = 0;
  for (const acc of accounts) {
    const bal = accountBalanceAsOf(acc, transactions, asOfDate);
    if (bal >= 0) {
      cashAssets += bal;
    } else {
      accountLiabilities += Math.abs(bal);
    }
  }

  let trackedAssets = 0;
  let trackedLiabilities = 0;
  for (const item of items) {
    const val = Math.max(0, Math.trunc(item.current_value || 0));
    if (item.kind === "asset") {
      trackedAssets += val;
    } else {
      trackedLiabilities += val;
    }
  }

  const totalAssets = cashAssets + trackedAssets;
  const totalLiabilities = accountLiabilities + trackedLiabilities;
  return {
    cashAssets,
    accountLiabilities,
    trackedAssets,
    trackedLiabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

function itemValueAsOf(
  item: NetWorthItem,
  snapshotsForItem: readonly NetWorthSnapshot[],
  asOfDate: string,
  isCurrentMonth: boolean,
): number {
  let latest: NetWorthSnapshot | null = null;
  for (const s of snapshotsForItem) {
    if (s.date > asOfDate) continue;
    if (!latest || s.date >= latest.date) {
      latest = s;
    }
  }
  if (latest) {
    return Math.max(0, Math.trunc(latest.value || 0));
  }
  if (isCurrentMonth || item.as_of_date <= asOfDate) {
    return Math.max(0, Math.trunc(item.current_value || 0));
  }
  return 0;
}

/**
 * Builds a monthly Net Worth trend series over `months` months ending at `asOfDate`.
 */
export function buildNetWorthSeries(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  items: readonly NetWorthItem[],
  snapshots: readonly NetWorthSnapshot[],
  months: number = 12,
  asOfDate: string = today(),
): NetWorthSeriesPoint[] {
  const count = Math.max(1, Math.min(60, Math.trunc(months)));
  const endMonth = asOfDate.slice(0, 7);

  const byItem = new Map<string, NetWorthSnapshot[]>();
  for (const s of snapshots) {
    const list = byItem.get(s.item_id) ?? [];
    list.push(s);
    byItem.set(s.item_id, list);
  }
  for (const list of byItem.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  const points: NetWorthSeriesPoint[] = [];
  for (let i = 0; i < count; i++) {
    const month = shiftMonth(endMonth, -(count - 1) + i);
    const isCurrentMonth = month === endMonth;
    const monthEnd = lastDayOfMonth(month);
    const pointDate =
      isCurrentMonth && asOfDate < monthEnd ? asOfDate : monthEnd;

    let cashAssets = 0;
    let accountLiabilities = 0;
    for (const acc of accounts) {
      const bal = accountBalanceAsOf(acc, transactions, pointDate);
      if (bal >= 0) {
        cashAssets += bal;
      } else {
        accountLiabilities += Math.abs(bal);
      }
    }

    let trackedAssets = 0;
    let trackedLiabilities = 0;
    for (const item of items) {
      const val = itemValueAsOf(
        item,
        byItem.get(item.id) ?? [],
        pointDate,
        isCurrentMonth,
      );
      if (item.kind === "asset") {
        trackedAssets += val;
      } else {
        trackedLiabilities += val;
      }
    }

    const totalAssets = cashAssets + trackedAssets;
    const totalLiabilities = accountLiabilities + trackedLiabilities;
    points.push({
      month,
      date: pointDate,
      cashAssets,
      accountLiabilities,
      trackedAssets,
      trackedLiabilities,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    });
  }
  return points;
}

export function validateNetWorthItem(
  item: Omit<NetWorthItem, "id"> & { id?: string },
): void {
  if (!item.name.trim() || item.name.trim().length > 80) {
    throw new Error("Item name must be between 1 and 80 characters.");
  }
  if (item.kind !== "asset" && item.kind !== "liability") {
    throw new Error("Choose asset or liability.");
  }
  const meta = NET_WORTH_CATEGORIES[item.category];
  if (!meta || meta.kind !== item.kind) {
    throw new Error("Choose a valid category for this item type.");
  }
  if (
    !Number.isSafeInteger(item.current_value) ||
    item.current_value < 0 ||
    item.current_value > MAX_VALUE_FILS
  ) {
    throw new Error(
      "Current value must be zero or greater and within the supported limit.",
    );
  }
  if (
    !isIsoCalendarDate(item.as_of_date) ||
    item.as_of_date < "1970-01-01" ||
    item.as_of_date > "2100-12-31"
  ) {
    throw new Error("Choose a valid valuation date.");
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(item.color)) {
    throw new Error("Choose a valid hex color.");
  }
  if (item.notes && item.notes.length > 500) {
    throw new Error("Notes must be 500 characters or fewer.");
  }
}

export function validateNetWorthSnapshot(
  snapshot: Omit<NetWorthSnapshot, "id"> & { id?: string },
): void {
  if (!snapshot.item_id) {
    throw new Error("Choose a net worth item.");
  }
  if (
    !Number.isSafeInteger(snapshot.value) ||
    snapshot.value < 0 ||
    snapshot.value > MAX_VALUE_FILS
  ) {
    throw new Error(
      "Valuation must be zero or greater and within the supported limit.",
    );
  }
  if (
    !isIsoCalendarDate(snapshot.date) ||
    snapshot.date < "1970-01-01" ||
    snapshot.date > "2100-12-31"
  ) {
    throw new Error("Choose a valid snapshot date.");
  }
  if (snapshot.notes && snapshot.notes.length > 500) {
    throw new Error("Notes must be 500 characters or fewer.");
  }
}

export { addDaysIso };
