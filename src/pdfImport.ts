import {
  minor,
  validateTransaction,
  type Ledger,
} from "./domain.ts";
import { transactionKey, type ImportTransaction } from "./csv.ts";
import { applyRules } from "./rules.ts";
import { categorise, type CategorySuggestion } from "./ledger/categoriser.ts";
import { guessMap, type CategoryMap } from "./ledger/mapping.ts";
import { displayPayee } from "./ledger/smsImport.ts";

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface PdfLine {
  page: number;
  y: number;
  text: string;
  items: PdfTextItem[];
}

export const PDF_BANKS = [
  "ENBD",
  "ADCB",
  "FAB",
  "Mashreq",
  "Liv",
  "ADIB",
  "Generic",
] as const;

export type PdfBank = (typeof PDF_BANKS)[number];

export interface PdfPreviewRow {
  index: number;
  page: number;
  rawLine: string;
  date: string;
  description: string;
  amount: number;
  kind: "expense" | "income";
  transaction: ImportTransaction | null;
  suggestion: CategorySuggestion | null;
  duplicate: boolean;
  error: string;
}

export interface PdfParseWarning {
  page: number;
  line: string;
  reason: string;
}

export interface PdfImportOptions {
  account: string;
  bank?: PdfBank | null;
  dateFormat?: "DMY" | "MDY";
}

export interface PdfImportResult {
  bank: PdfBank;
  rows: PdfPreviewRow[];
  warnings: PdfParseWarning[];
  pageCount: number;
}

/**
 * Group raw PDF text items into reading-order lines by Y-coordinate (top to bottom)
 * and sort items within each line by X-coordinate (left to right).
 */
export function groupTextItemsIntoLines(
  items: PdfTextItem[],
  page = 1,
  yTolerance = 3,
): PdfLine[] {
  const nonEmpty = items.filter((item) => item.str.trim().length > 0);
  if (!nonEmpty.length) return [];

  const sorted = [...nonEmpty].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; items: PdfTextItem[] }[] = [];

  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.y - item.y) <= yTolerance) {
      last.items.push(item);
    } else {
      groups.push({ y: item.y, items: [item] });
    }
  }

  return groups.map((g) => {
    const xSorted = [...g.items].sort((a, b) => a.x - b.x);
    let text = "";
    for (let i = 0; i < xSorted.length; i++) {
      const curr = xSorted[i];
      if (i === 0) {
        text = curr.str;
        continue;
      }
      const prev = xSorted[i - 1];
      const prevEnd = prev.x + (prev.width ?? 0);
      const gap = prev.width !== undefined ? curr.x - prevEnd : 2;
      const needsSpace =
        gap > 1.5 &&
        !text.endsWith(" ") &&
        !curr.str.startsWith(" ");
      text += (needsSpace ? " " : "") + curr.str;
    }
    return {
      page,
      y: g.y,
      text: text.replace(/\s+/g, " ").trim(),
      items: xSorted,
    };
  });
}

/**
 * Extract text lines from every page of a PDF buffer 100% client-side using pdfjs-dist.
 */
export async function extractPdfPages(
  buffer: ArrayBuffer,
  workerSrc?: string,
): Promise<PdfLine[][]> {
  const pdfjs = await import("pdfjs-dist");
  if (workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }

  let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
    });
    const doc = await loadingTask.promise;
    const pages: PdfLine[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if ("str" in raw && typeof raw.str === "string") {
          items.push({
            str: raw.str,
            x: raw.transform[4] ?? 0,
            y: raw.transform[5] ?? 0,
            width: typeof raw.width === "number" ? raw.width : undefined,
            height: typeof raw.height === "number" ? raw.height : undefined,
          });
        }
      }
      pages.push(groupTextItemsIntoLines(items, p));
    }
    return pages;
  } catch (err: unknown) {
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name: unknown }).name)
        : "";
    const msg = err instanceof Error ? err.message : String(err);
    if (
      name === "PasswordException" ||
      /password/i.test(msg)
    ) {
      throw new Error(
        "This PDF is password-protected. Unlock it first, then try again.",
      );
    }
    throw new Error(`Could not read PDF: ${msg}`);
  } finally {
    await loadingTask?.destroy();
  }
}

/** Detect which UAE bank issued the statement from its text lines. */
export function detectPdfBank(lines: PdfLine[]): PdfBank {
  const sample = lines
    .slice(0, 60)
    .map((l) => l.text)
    .join("\n");
  if (/\bliv\.?\s*(bank|account|statement)?\b|liv\.me/i.test(sample)) {
    return "Liv";
  }
  if (/\bemirates\s*nbd\b|\benbd\b/i.test(sample)) {
    return "ENBD";
  }
  if (/\babu\s*dhabi\s*commercial\s*bank\b|\badcb\b/i.test(sample)) {
    return "ADCB";
  }
  if (/\bfirst\s*abu\s*dhabi\s*bank\b|\bfab\b/i.test(sample)) {
    return "FAB";
  }
  if (/\bmashreq\b|\bmashreq\s*neo\b/i.test(sample)) {
    return "Mashreq";
  }
  if (/\babu\s*dhabi\s*islamic\s*bank\b|\badib\b/i.test(sample)) {
    return "ADIB";
  }
  return "Generic";
}

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function normalizeYear(raw: string): string {
  if (raw.length === 4) return raw;
  const n = Number(raw);
  return String(n >= 80 ? 1900 + n : 2000 + n);
}

function validateIsoDate(y: string, m: string, d: string): string | null {
  const mm = m.padStart(2, "0");
  const dd = d.padStart(2, "0");
  const iso = `${y}-${mm}-${dd}`;
  const yr = Number(y);
  if (yr < 1970 || yr > 2100) return null;
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  if (new Date(parsed).toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Parse a leading date from a statement line, returning ISO date + remaining text. */
export function extractLeadingDate(
  line: string,
  dateFormat: "DMY" | "MDY" = "DMY",
): { date: string; rest: string } | null {
  const trimmed = line.trim();

  // YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\b(.*)$/);
  if (m) {
    const iso = validateIsoDate(m[1], m[2], m[3]);
    if (iso) return { date: iso, rest: m[4].trim() };
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY
  m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b(.*)$/);
  if (m) {
    const a = m[1];
    const b = m[2];
    const y = normalizeYear(m[3]);
    const [day, mon] =
      dateFormat === "MDY" || (Number(b) > 12 && Number(a) <= 12)
        ? [b, a]
        : [a, b];
    const iso = validateIsoDate(y, mon, day);
    if (iso) return { date: iso, rest: m[4].trim() };
  }

  // DD MMM YYYY or DD-MMM-YYYY or DD MMM YY
  m = trimmed.match(
    /^(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-,]+(\d{2,4})\b(.*)$/,
  );
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) {
      const iso = validateIsoDate(normalizeYear(m[3]), mon, m[1]);
      if (iso) return { date: iso, rest: m[4].trim() };
    }
  }

  // MMM DD, YYYY
  m = trimmed.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})\b(.*)$/,
  );
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) {
      const iso = validateIsoDate(normalizeYear(m[3]), mon, m[2]);
      if (iso) return { date: iso, rest: m[4].trim() };
    }
  }

  return null;
}

interface AmountToken {
  raw: string;
  /** Positive integer fils */
  fils: number;
  signHint: "debit" | "credit" | null;
  startIndex: number;
  endIndex: number;
  x?: number;
}

const AMOUNT_RE =
  /(?:\(\s*)?(?:AED\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?:\s*\))?(?:\s*(?:CR|DR))?/gi;

function extractAmountTokens(
  text: string,
  lineItems: PdfTextItem[],
): AmountToken[] {
  const tokens: AmountToken[] = [];
  for (const match of text.matchAll(AMOUNT_RE)) {
    const raw = match[0];
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + raw.length;
    const cleanedNum = raw
      .replace(/AED/gi, "")
      .replace(/CR|DR/gi, "")
      .replace(/[(),+\s]/g, "");
    const fils = Math.abs(minor(cleanedNum));
    let signHint: "debit" | "credit" | null = null;
    if (/\bCR\b/i.test(raw) || /^\s*\+/.test(raw)) signHint = "credit";
    else if (
      /\bDR\b/i.test(raw) ||
      /^\s*-/.test(raw) ||
      /^\s*\(.*\)\s*$/.test(raw)
    ) {
      signHint = "debit";
    }

    // Best-effort match to an item X coordinate
    const numOnly = cleanedNum.replace(/^-/, "");
    const matchingItem = lineItems.find((it) => it.str.includes(numOnly));
    tokens.push({
      raw,
      fils,
      signHint,
      startIndex,
      endIndex,
      x: matchingItem?.x,
    });
  }
  return tokens;
}

interface ColumnPositions {
  debitX?: number;
  creditX?: number;
  balanceX?: number;
}

function detectHeaderColumns(line: PdfLine): ColumnPositions | null {
  if (extractLeadingDate(line.text)) return null;
  if (extractAmountTokens(line.text, []).length > 0) return null;
  const lower = line.text.toLowerCase();
  const hasDate = /\bdate\b/.test(lower);
  const hasAmountWord =
    /\b(debit|withdrawal|withdrawals|dr|credit|deposit|deposits|cr|amount|balance)\b/.test(
      lower,
    );
  if (!hasDate && !hasAmountWord) return null;

  let debitX: number | undefined;
  let creditX: number | undefined;
  let balanceX: number | undefined;

  for (const item of line.items) {
    const s = item.str.trim().toLowerCase();
    if (!s) continue;
    if (/\b(debit|withdrawal|withdrawals|money out|dr)\b/.test(s)) {
      debitX = item.x;
    } else if (/\b(credit|deposit|deposits|money in|cr)\b/.test(s)) {
      creditX = item.x;
    } else if (/\b(balance|bal)\b/.test(s)) {
      balanceX = item.x;
    }
  }

  if (
    debitX !== undefined ||
    creditX !== undefined ||
    balanceX !== undefined
  ) {
    return { debitX, creditX, balanceX };
  }
  return null;
}

const NOISE_LINE_RE =
  /^(?:page\s+\d+(?:\s+of\s+\d+)?|opening\s+balance|closing\s+balance|brought\s+forward|carried\s+forward|total\s+(?:debits?|credits?|withdrawals?|deposits?)|statement\s+(?:period|date|summary)|account\s+(?:number|no\.?|summary|iban)|iban\b|currency\s*:|emirates\s+nbd|abu\s+dhabi\s+commercial|first\s+abu\s+dhabi|mashreq\s+bank|abu\s+dhabi\s+islamic|liv\.?\s+bank)/i;

const INCOME_DESC_RE =
  /\b(salary|payroll|refund|cashback|reversal|reversed|inward\s+remittance|received\s+from|credit\s+interest|interest\s+earned|dividend|deposit\b|cr\s+transfer)\b/i;

const BANK_PREFIX_RE =
  /^(?:pos\s+purchase|visa\s+purchase|mastercard\s+purchase|debit\s+card\s+purchase|card\s+purchase|online\s+purchase|ecom\s+purchase|atm\s+withdrawal|cash\s+withdrawal|ipp\s+transfer|mbanking\s+transfer|mobile\s+banking|fund\s+transfer|outward\s+transfer|inward\s+transfer|bill\s+payment|direct\s+debit)\s*[-:]*\s*/i;

function cleanDescriptionForPayee(description: string): string {
  let cleaned = description
    .replace(/\bcard\s*(?:no\.?|ending|x+)\s*[\dx*]{4,}\b/gi, " ")
    .replace(/\bref(?:erence)?\s*(?:no\.?|:)?\s*[a-z0-9-]{6,}\b/gi, " ")
    .replace(/\bauth(?:orisation|orization)?\s*(?:code)?\s*:?\s*\d+\b/gi, " ")
    .replace(BANK_PREFIX_RE, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) cleaned = description.trim();
  const formatted = displayPayee(cleaned);
  return (formatted || cleaned).slice(0, 120);
}

interface CandidateRow {
  page: number;
  date: string;
  rawLine: string;
  description: string;
  tokens: AmountToken[];
  cols: ColumnPositions | null;
}

function resolveAmountAndKind(
  c: CandidateRow,
  prevBalance: number | null,
): { amount: number; kind: "expense" | "income"; balance: number | null } | null {
  const { tokens, cols, description } = c;
  if (!tokens.length) return null;

  // Filter out explicit 0.00 placeholders when there are multiple columns
  if (tokens.length >= 3) {
    const last = tokens[tokens.length - 1];
    const debitTok = tokens[tokens.length - 3];
    const creditTok = tokens[tokens.length - 2];

    // Standard [Debit, Credit, Balance]
    if (debitTok.fils > 0 && creditTok.fils === 0) {
      return { amount: debitTok.fils, kind: "expense", balance: last.fils };
    }
    if (creditTok.fils > 0 && debitTok.fils === 0) {
      return { amount: creditTok.fils, kind: "income", balance: last.fils };
    }
    // Both non-zero or both zero: fall back to first non-zero
    const nonZero = tokens.slice(0, -1).find((t) => t.fils > 0);
    if (!nonZero) return null;
    return {
      amount: nonZero.fils,
      kind:
        nonZero.signHint === "credit" || INCOME_DESC_RE.test(description)
          ? "income"
          : "expense",
      balance: last.fils,
    };
  }

  if (tokens.length === 2) {
    const [txTok, balTok] = tokens;
    if (txTok.fils === 0) return null;

    let kind: "expense" | "income" | null = null;
    if (txTok.signHint) {
      kind = txTok.signHint === "credit" ? "income" : "expense";
    } else if (
      cols?.debitX !== undefined &&
      cols?.creditX !== undefined &&
      txTok.x !== undefined
    ) {
      kind =
        Math.abs(txTok.x - cols.creditX) < Math.abs(txTok.x - cols.debitX)
          ? "income"
          : "expense";
    } else if (prevBalance !== null) {
      if (balTok.fils - prevBalance === txTok.fils) kind = "income";
      else if (prevBalance - balTok.fils === txTok.fils) kind = "expense";
    }

    if (!kind) {
      kind = INCOME_DESC_RE.test(description) ? "income" : "expense";
    }
    return { amount: txTok.fils, kind, balance: balTok.fils };
  }

  // Single token (no balance column on this line)
  const tok = tokens[0];
  if (tok.fils === 0) return null;
  let kind: "expense" | "income" | null = null;
  if (tok.signHint) {
    kind = tok.signHint === "credit" ? "income" : "expense";
  } else if (
    cols?.debitX !== undefined &&
    cols?.creditX !== undefined &&
    tok.x !== undefined
  ) {
    kind =
      Math.abs(tok.x - cols.creditX) < Math.abs(tok.x - cols.debitX)
        ? "income"
        : "expense";
  } else {
    kind = INCOME_DESC_RE.test(description) ? "income" : "expense";
  }
  return { amount: tok.fils, kind, balance: null };
}

function mapCanonicalToCategory(
  suggestion: CategorySuggestion | null,
  categoryMap: CategoryMap,
): string | null {
  if (!suggestion?.category) return null;
  return categoryMap[suggestion.category] ?? null;
}

/**
 * Parse grouped PDF page lines into reviewable Fuloos import rows with
 * categorisation, rule application, and duplicate detection.
 */
export function parsePdfStatement(
  pages: PdfLine[][],
  options: PdfImportOptions,
  ledger: Ledger,
): PdfImportResult {
  const allLines = pages.flat();
  const bank = options.bank ?? detectPdfBank(allLines);
  const dateFormat = options.dateFormat ?? "DMY";
  const categoryMap = guessMap(ledger.categories);
  const rules = ledger.rules ?? [];

  const candidates: CandidateRow[] = [];
  const warnings: PdfParseWarning[] = [];
  let activeCols: ColumnPositions | null = null;
  let current: CandidateRow | null = null;

  const flushCurrent = () => {
    if (!current) return;
    if (current.tokens.length > 0) {
      candidates.push(current);
    } else if (current.description) {
      warnings.push({
        page: current.page,
        line: current.rawLine,
        reason: "Dated line had no recognisable AED amount.",
      });
    }
    current = null;
  };

  for (const pageLines of pages) {
    for (const line of pageLines) {
      const headerCols = detectHeaderColumns(line);
      if (headerCols) {
        flushCurrent();
        activeCols = headerCols;
        continue;
      }

      if (NOISE_LINE_RE.test(line.text)) {
        flushCurrent();
        continue;
      }

      const leading = extractLeadingDate(line.text, dateFormat);
      if (leading) {
        flushCurrent();
        let rest = leading.rest;
        // Strip optional second Value Date right after Transaction Date
        const secondDate = extractLeadingDate(rest, dateFormat);
        if (secondDate) {
          rest = secondDate.rest;
        }

        const tokens = extractAmountTokens(rest, line.items);
        let description = rest;
        if (tokens.length > 0) {
          description = rest.slice(0, tokens[0].startIndex).trim();
        }
        description = description.replace(/\s+/g, " ").trim();

        current = {
          page: line.page,
          date: leading.date,
          rawLine: line.text,
          description,
          tokens,
          cols: activeCols,
        };
        continue;
      }

      // Non-dated line
      const lineTokens = extractAmountTokens(line.text, line.items);
      if (current && lineTokens.length === 0) {
        // Continuation of previous transaction's multi-line description
        current.description = `${current.description} ${line.text}`
          .replace(/\s+/g, " ")
          .trim();
        current.rawLine = `${current.rawLine} | ${line.text}`;
      } else if (current && current.tokens.length === 0 && lineTokens.length > 0) {
        // Amount appeared on the wrapped line
        current.tokens = lineTokens;
        const extraDesc = line.text.slice(0, lineTokens[0].startIndex).trim();
        if (extraDesc) {
          current.description = `${current.description} ${extraDesc}`
            .replace(/\s+/g, " ")
            .trim();
        }
        current.rawLine = `${current.rawLine} | ${line.text}`;
      } else if (lineTokens.length > 0) {
        flushCurrent();
        warnings.push({
          page: line.page,
          line: line.text,
          reason: "Amount found without a valid transaction date.",
        });
      }
    }
    flushCurrent();
  }

  let prevBalance: number | null = null;
  const rows: PdfPreviewRow[] = candidates.map((c, index) => {
    const resolved = resolveAmountAndKind(c, prevBalance);
    if (!resolved) {
      return {
        index,
        page: c.page,
        rawLine: c.rawLine,
        date: c.date,
        description: c.description,
        amount: 0,
        kind: "expense",
        transaction: null,
        suggestion: null,
        duplicate: false,
        error: "Could not determine transaction amount.",
      };
    }

    if (resolved.balance !== null) {
      prevBalance = resolved.balance;
    }

    const payee = cleanDescriptionForPayee(c.description);
    const amountAed = resolved.amount / 100;
    const suggestion =
      resolved.kind === "expense"
        ? categorise(null, payee || c.description, amountAed)
        : null;
    const suggestedCatId =
      resolved.kind === "expense"
        ? mapCanonicalToCategory(suggestion, categoryMap)
        : null;

    let tx: ImportTransaction = {
      date: c.date,
      account_id: options.account,
      to_account_id: null,
      category_id: suggestedCatId,
      type: resolved.kind,
      amount: resolved.amount,
      payee,
      notes: `From ${bank} PDF · ${c.description}`.slice(0, 500),
    };

    if (rules.length) {
      const res = applyRules(rules, tx, {
        overwriteCategory: false,
        overwritePayee: false,
      });
      if (res.matchedRules.length) {
        tx = {
          ...tx,
          category_id: res.category_id,
          payee: res.payee,
          ...(res.tags.length ? { tags: res.tags } : {}),
        };
      }
    }

    try {
      validateTransaction(tx, ledger);
      return {
        index,
        page: c.page,
        rawLine: c.rawLine,
        date: c.date,
        description: c.description,
        amount: resolved.amount,
        kind: resolved.kind,
        transaction: tx,
        suggestion,
        duplicate: false,
        error: "",
      };
    } catch (e) {
      return {
        index,
        page: c.page,
        rawLine: c.rawLine,
        date: c.date,
        description: c.description,
        amount: resolved.amount,
        kind: resolved.kind,
        transaction: null,
        suggestion,
        duplicate: false,
        error: e instanceof Error ? e.message : "Invalid transaction.",
      };
    }
  });

  return {
    bank,
    rows: markPdfDuplicates(rows, ledger),
    warnings,
    pageCount: pages.length,
  };
}

/**
 * Mark rows that match an existing ledger transaction or an earlier row in the same PDF batch.
 */
export function markPdfDuplicates(
  rows: PdfPreviewRow[],
  ledger: Ledger,
): PdfPreviewRow[] {
  const seen = new Set(ledger.transactions.map(transactionKey));
  return rows.map((row) => {
    if (!row.transaction) return { ...row, duplicate: false };
    const key = transactionKey(row.transaction);
    const duplicate = seen.has(key);
    seen.add(key);
    return { ...row, duplicate };
  });
}
