import type { Account, Ledger, Transaction } from "./domain.ts";
import type { ImportTransaction } from "./csv.ts";

/**
 * Finds imported rows that are one side of a money movement between two of
 * the user's own accounts (a transfer or a credit card payment), so importing
 * statements from several banks, in any order, does not count the same money
 * twice.
 *
 * - "pair": the other side is already in the ledger as an expense or income.
 *   Importing turns that transaction into a transfer and skips the new row.
 * - "recorded": the ledger already has this transfer (for example from the
 *   other bank's statement). The row is a duplicate.
 * - "named": the payee or notes name another account and nothing matches yet.
 *   The row is imported as a transfer; the other statement then finds it as
 *   "recorded".
 *
 * "sure" matches are applied straight away; "likely" ones wait for the user.
 */
export type TransferMatchKind = "pair" | "recorded" | "named";
export type TransferConfidence = "sure" | "likely";

export interface TransferMatch {
  index: number;
  kind: TransferMatchKind;
  confidence: TransferConfidence;
  /** The account on the other side of the transfer. */
  otherAccount: string;
  /** The existing transaction this row matched, for "pair" and "recorded". */
  counterpart: Transaction | null;
  /** Short, human reasons, e.g. "same day", "payee names Liv". */
  reasons: string[];
}

export interface MatchableRow {
  index: number;
  transaction: ImportTransaction | null;
  /** Already in the ledger as it is; such rows are never re-classified. */
  duplicate?: boolean;
}

/** Legs of one transfer can post a few days apart (weekends, card cycles). */
export const TRANSFER_WINDOW_DAYS = 4;

const GENERIC_WORDS = new Set([
  "a",
  "acc",
  "account",
  "and",
  "bank",
  "banking",
  "card",
  "cards",
  "cash",
  "cc",
  "credit",
  "current",
  "debit",
  "my",
  "of",
  "pay",
  "payment",
  "savings",
  "the",
  "wallet",
]);

const TRANSFER_WORDS =
  /\b(transfer|trf|tfr|xfer|trx to|own account|bill payment|card payment|cc payment|repayment|card repay|payment received|payment thank you|top ?up|ipp|move to|moved to|sent to|received from)\b/;

const CARD_WORDS =
  /\b(credit card|card payment|cc payment|card repayment|card bill)\b/;

export function normalizeText(value: string): string {
  return ` ${value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function distinctiveWords(name: string): string[] {
  return normalizeText(name)
    .trim()
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * How strongly `text` names `account`: 3 when the whole account name appears,
 * 1 when only a distinctive word of it does (e.g. "Liv" for "Liv Bank"), or
 * when a credit card account meets "credit card" or "card payment".
 */
export function nameScore(text: string, account: Account): number {
  const name = normalizeText(account.name);
  if (name.trim().length < 2) return 0;
  if (text.includes(name)) return 3;
  if (distinctiveWords(account.name).some((w) => text.includes(` ${w} `)))
    return 1;
  return account.type === "credit_card" && CARD_WORDS.test(text) ? 1 : 0;
}

function hasTransferWords(text: string): boolean {
  return TRANSFER_WORDS.test(text);
}

const dayNumber = (iso: string) =>
  Math.round(Date.parse(iso + "T12:00:00Z") / 86_400_000);

function dateScore(days: number): number {
  return days === 0 ? 3 : days === 1 ? 2 : 1;
}

interface Candidate {
  index: number;
  row: ImportTransaction;
  counterpart: Transaction;
  kind: "pair" | "recorded";
  otherAccount: string;
  score: number;
  hinted: boolean;
  reasons: string[];
}

function rowText(t: Pick<Transaction, "payee" | "notes">) {
  return normalizeText(`${t.payee} ${t.notes}`);
}

export function findTransferMatches(
  rows: MatchableRow[],
  importAccount: string,
  ledger: Ledger,
): TransferMatch[] {
  const self = ledger.accounts.find((a) => a.id === importAccount);
  if (!self) return [];
  const others = ledger.accounts.filter((a) => a.id !== importAccount);
  if (!others.length) return [];
  const recurringLinked = new Set(
    (ledger.recurring_occurrences ?? []).map((o) => o.transaction_id),
  );

  const byAmount = new Map<number, Transaction[]>();
  for (const t of ledger.transactions) {
    const list = byAmount.get(t.amount);
    if (list) list.push(t);
    else byAmount.set(t.amount, [t]);
  }

  rows = rows.filter((r) => !r.duplicate);
  const candidates: Candidate[] = [];
  const named: TransferMatch[] = [];
  for (const { index, transaction: row } of rows) {
    if (!row || row.type === "transfer" || row.account_id !== importAccount)
      continue;
    if (row.amount <= 0) continue;
    const out = row.type === "expense";
    const text = rowText(row);
    const words = hasTransferWords(text);
    const day = dayNumber(row.date);
    for (const t of byAmount.get(row.amount) ?? []) {
      const days = Math.abs(dayNumber(t.date) - day);
      if (days > TRANSFER_WINDOW_DAYS) continue;
      let kind: Candidate["kind"];
      let other: string;
      if (t.type === "transfer") {
        // Already recorded from the other side, in the same direction.
        if (
          out
            ? t.account_id !== importAccount
            : t.to_account_id !== importAccount
        )
          continue;
        kind = "recorded";
        other = (out ? t.to_account_id : t.account_id) ?? "";
      } else {
        if (t.account_id === importAccount) continue;
        if (t.type === (out ? "expense" : "income")) continue;
        if (recurringLinked.has(t.id)) continue;
        kind = "pair";
        other = t.account_id;
      }
      const otherAccount = ledger.accounts.find((a) => a.id === other);
      if (!otherAccount) continue;
      const reasons = [
        days === 0
          ? "same amount, same day"
          : `same amount, ${days} ${days === 1 ? "day" : "days"} apart`,
      ];
      let hints = 0;
      const rowNames = nameScore(text, otherAccount);
      if (rowNames) {
        hints += rowNames;
        reasons.push(`description names ${otherAccount.name}`);
      }
      const theirText = rowText(t);
      if (kind === "pair") {
        const theyName = nameScore(theirText, self);
        if (theyName) {
          hints += theyName;
          reasons.push(`${otherAccount.name} entry names ${self.name}`);
        }
      }
      if (words) hints += 1;
      if (kind === "pair" && hasTransferWords(theirText)) hints += 1;
      if (words || (kind === "pair" && hasTransferWords(theirText)))
        reasons.push("transfer wording");
      if (kind === "recorded") {
        hints += 3;
        reasons.unshift(
          `already recorded as a transfer ${out ? "to" : "from"} ${otherAccount.name}`,
        );
      }
      // Without any hint, an equal amount a few days away is usually chance.
      if (!hints && days > 1) continue;
      candidates.push({
        index,
        row,
        counterpart: t,
        kind,
        otherAccount: other,
        score: dateScore(days) + hints,
        hinted: hints > 0,
        reasons,
      });
    }
  }

  // Each row and each existing transaction is used at most once: best first.
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(dayNumber(a.counterpart.date) - dayNumber(a.row.date)) -
        Math.abs(dayNumber(b.counterpart.date) - dayNumber(b.row.date)) ||
      a.index - b.index,
  );
  const perRow = new Map<number, Candidate[]>();
  const perTx = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = perRow.get(c.index);
    if (list) list.push(c);
    else perRow.set(c.index, [c]);
    const txList = perTx.get(c.counterpart.id);
    if (txList) txList.push(c);
    else perTx.set(c.counterpart.id, [c]);
  }
  const usedRows = new Set<number>();
  const usedTx = new Set<string>();
  const matches: TransferMatch[] = [];
  for (const c of candidates) {
    if (usedRows.has(c.index) || usedTx.has(c.counterpart.id)) continue;
    usedRows.add(c.index);
    usedTx.add(c.counterpart.id);
    // A close runner-up for the same row or same counterpart transaction means we are guessing.
    const rowRivals = (perRow.get(c.index) ?? []).filter(
      (o) =>
        o !== c &&
        !usedTx.has(o.counterpart.id) &&
        o.otherAccount !== c.otherAccount &&
        o.score >= c.score - 1,
    );
    const txRivals = (perTx.get(c.counterpart.id) ?? []).filter(
      (o) => o !== c && !usedRows.has(o.index) && o.score >= c.score - 1,
    );
    const sure =
      c.hinted && c.score >= 5 && !rowRivals.length && !txRivals.length;
    matches.push({
      index: c.index,
      kind: c.kind,
      confidence: sure ? "sure" : "likely",
      otherAccount: c.otherAccount,
      counterpart: c.counterpart,
      reasons: c.reasons,
    });
  }

  // Rows with no counterpart yet: does the description name another account?
  for (const { index, transaction: row } of rows) {
    if (
      !row ||
      usedRows.has(index) ||
      row.type === "transfer" ||
      row.account_id !== importAccount ||
      row.amount <= 0
    )
      continue;
    const text = rowText(row);
    if (
      nameScore(text, self) === 3 &&
      !others.some((a) => nameScore(text, a) === 3)
    )
      continue;
    const scored = others
      .map((a) => ({ a, s: nameScore(text, a) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s);
    if (!scored.length) continue;
    const [best, next] = scored;
    if (next && next.s === best.s) continue;
    const words = hasTransferWords(text);
    if (best.s < 3 && !words) continue;
    const payeeIsAccount =
      normalizeText(row.payee) === normalizeText(best.a.name);
    named.push({
      index,
      kind: "named",
      confidence: best.s === 3 && (payeeIsAccount || words) ? "sure" : "likely",
      otherAccount: best.a.id,
      counterpart: null,
      reasons: [
        best.s === 3
          ? `description names ${best.a.name}`
          : `description mentions ${best.a.name}`,
        ...(words ? ["transfer wording"] : []),
      ],
    });
  }
  return [...matches, ...named].sort((a, b) => a.index - b.index);
}

/**
 * The transfer that replaces an existing expense/income once its other leg
 * is imported. The existing record keeps its id, date, payee and notes.
 */
export function pairedTransfer(
  counterpart: Transaction,
  importAccount: string,
): Transaction {
  const counterpartIsOut = counterpart.type === "expense";
  return {
    ...counterpart,
    type: "transfer",
    category_id: null,
    account_id: counterpartIsOut ? counterpart.account_id : importAccount,
    to_account_id: counterpartIsOut ? importAccount : counterpart.account_id,
  };
}

export type TransferDecision = "accept" | "reject";

/** The matches that apply, given what the user accepted or rejected. */
export function appliedMatches(
  matches: TransferMatch[],
  decisions: ReadonlyMap<number, TransferDecision>,
): TransferMatch[] {
  return matches.filter((m) => {
    const d = decisions.get(m.index);
    return d ? d === "accept" : m.confidence === "sure";
  });
}
