import type { BudgetReport } from "./budgets.ts";
import type { Ledger, Transaction } from "./domain.ts";

export interface SpendingSummaryItem {
  name: string;
  total: number;
}

/**
 * Formats integer fils as a decimal AED string without floating-point arithmetic.
 */
export function formatFils(amount: number): string {
  const safe = Math.trunc(amount);
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Escapes a single CSV cell per RFC 4180 and guards against CSV formula
 * injection (cells starting with =, +, -, @, tab, or carriage return).
 * Numeric values (such as negative net cash flow) are preserved as numbers
 * when `numeric: true` and the formatted value is strictly a number.
 */
export function escapeCsvCell(
  value: string | number | null | undefined,
  options?: { numeric?: boolean },
): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  const isStrictNumber = options?.numeric && /^-?\d+(?:\.\d+)?$/.test(s);
  if (!isStrictNumber && (/^[=+\-@\t\r]/.test(s) || /^\s+[=+\-@]/.test(s))) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type CsvCellInput =
  | string
  | number
  | null
  | undefined
  | { value: string | number | null | undefined; numeric?: boolean };

export function toCsvRow(cells: CsvCellInput[]): string {
  return cells
    .map((cell) =>
      typeof cell === "object" && cell !== null
        ? escapeCsvCell(cell.value, { numeric: cell.numeric })
        : escapeCsvCell(cell, { numeric: typeof cell === "number" }),
    )
    .join(",");
}

export function transactionsToCsv(
  transactions: Transaction[],
  ledger: Ledger,
): string {
  const accountNames = new Map(ledger.accounts.map((a) => [a.id, a.name]));
  const categoryNames = new Map(ledger.categories.map((c) => [c.id, c.name]));

  const lines: string[] = [
    toCsvRow([
      "Date",
      "Type",
      "Amount (AED)",
      "Account",
      "To Account",
      "Category",
      "Payee",
      "Notes",
    ]),
  ];

  for (const t of transactions) {
    lines.push(
      toCsvRow([
        t.date,
        t.type,
        { value: formatFils(t.amount), numeric: true },
        accountNames.get(t.account_id) ?? t.account_id,
        t.to_account_id
          ? (accountNames.get(t.to_account_id) ?? t.to_account_id)
          : "",
        t.category_id
          ? (categoryNames.get(t.category_id) ?? t.category_id)
          : "",
        t.payee,
        t.notes,
      ]),
    );
  }

  return lines.join("\r\n") + "\r\n";
}

export function reportToCsv(params: {
  rangeLabel: string;
  summary: { income: number; expense: number };
  spending: SpendingSummaryItem[];
  budgetReport?: BudgetReport;
}): string {
  const { rangeLabel, summary, spending, budgetReport } = params;
  const net = summary.income - summary.expense;
  const lines: string[] = [];

  lines.push(toCsvRow(["Summary", rangeLabel]));
  lines.push(toCsvRow(["Metric", "Amount (AED)"]));
  lines.push(
    toCsvRow(["Income", { value: formatFils(summary.income), numeric: true }]),
  );
  lines.push(
    toCsvRow([
      "Expenses",
      { value: formatFils(summary.expense), numeric: true },
    ]),
  );
  lines.push(
    toCsvRow(["Net cash flow", { value: formatFils(net), numeric: true }]),
  );

  lines.push("");
  lines.push(toCsvRow(["Category Spending", rangeLabel]));
  lines.push(toCsvRow(["Category", "Amount (AED)", "Share (%)"]));
  for (const item of spending) {
    const share =
      summary.expense > 0
        ? ((item.total / summary.expense) * 100).toFixed(1)
        : "0.0";
    lines.push(
      toCsvRow([
        item.name,
        { value: formatFils(item.total), numeric: true },
        { value: share, numeric: true },
      ]),
    );
  }

  if (budgetReport && (budgetReport.rows.length > 0 || budgetReport.unbudgeted > 0)) {
    lines.push("");
    lines.push(toCsvRow(["Budget vs Actual", rangeLabel]));
    lines.push(
      toCsvRow([
        "Category",
        "Budget (AED)",
        "Actual (AED)",
        "Remaining (AED)",
        "Used (%)",
        "Status",
        "Budgeted Months",
      ]),
    );
    for (const row of budgetReport.rows) {
      const pct =
        row.budget > 0
          ? ((row.actual / row.budget) * 100).toFixed(1)
          : row.actual > 0
            ? "Infinity"
            : "0.0";
      lines.push(
        toCsvRow([
          row.category.name,
          { value: formatFils(row.budget), numeric: true },
          { value: formatFils(row.actual), numeric: true },
          { value: formatFils(row.remaining), numeric: true },
          { value: pct, numeric: pct !== "Infinity" },
          row.status,
          row.budgetedMonths,
        ]),
      );
    }
    lines.push(
      toCsvRow([
        "Total Budgeted",
        { value: formatFils(budgetReport.totalBudget), numeric: true },
        { value: formatFils(budgetReport.totalActual), numeric: true },
        {
          value: formatFils(budgetReport.totalBudget - budgetReport.totalActual),
          numeric: true,
        },
        "",
        "",
        budgetReport.months.length,
      ]),
    );
    if (budgetReport.unbudgeted > 0) {
      lines.push(
        toCsvRow([
          "Unbudgeted Spending",
          "",
          { value: formatFils(budgetReport.unbudgeted), numeric: true },
          "",
          "",
          "",
          "",
        ]),
      );
    }
  }

  return lines.join("\r\n") + "\r\n";
}

export function downloadBlob(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
