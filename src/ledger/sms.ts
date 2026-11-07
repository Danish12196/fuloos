/* UAE bank SMS parser and merchant cleaner, ported from ledger-uae-banks (sms_transactions_pipeline.ipynb via
   site/try/sms.js). Pure functions: SMS text is parsed in the browser and never sent anywhere. */
import { LEDGER_RULES as T } from "./rules.generated.ts";

export type SmsType =
  | "purchase"
  | "bill_payment"
  | "cash_withdrawal"
  | "bank_fee"
  | "transfer_out"
  | "card_repayment"
  | "loan_repayment"
  | "internal_out"
  | "other_debit"
  | "refund"
  | "transfer_in"
  | "income"
  | "internal_in"
  | "card_payment_received"
  | "otp"
  | "declined"
  | "notice";

export interface ParsedSms {
  bank: string | null;
  txn_type: SmsType;
  direction: "debit" | "credit" | "none";
  amount: number;
  currency: string | null;
  amount_aed: number;
  card_last4: string | null;
  merchant_raw: string | null;
  merchant: string | null;
  merchant_clean: string | null;
  location: string | null;
  country: string | null;
  balance_after: number;
  is_bnpl: boolean;
  is_foreign: boolean;
  date_in_text: string | null;
}

const rx = (src: string, flags = "") => new RegExp(src, flags);
type Rule = [SmsType, RegExp];
const COMMON: Rule[] = T.COMMON_RULES.map(([t, s, f]) => [
  t as SmsType,
  rx(s, f),
]);
const BANKS: Record<string, Rule[]> = Object.fromEntries(
  Object.entries(T.BANK_RULES).map(([b, list]) => [
    b,
    (list as readonly (readonly string[])[]).map(
      ([t, s, f]): Rule => [t as SmsType, rx(s, f)],
    ),
  ]),
);
const BALANCE = rx(T.BALANCE_RX[0], T.BALANCE_RX[1]);
export const BANK_NAMES = Object.keys(BANKS);

function num(s: string | undefined | null): number {
  if (s == null) return NaN;
  s = String(s).replace(/,/g, "").trim().replace(/\.+$/, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}

function parseRaw(msg: string, bank: string | null) {
  const text = String(msg).replace(/\n/g, " ").trim();
  const rules: Rule[] = [
    ...COMMON,
    ...(bank ? (BANKS[bank] ?? []) : []),
    ["notice", /.*/s],
  ];
  for (const [type, re] of rules) {
    const m = re.exec(text);
    if (!m) continue;
    const g = m.groups || {};
    let balance = num(g.balance);
    if (
      Number.isNaN(balance) &&
      !["otp", "declined", "notice"].includes(type)
    ) {
      const b = BALANCE.exec(text);
      balance = b ? num(b.groups?.balance) : NaN;
    }
    const merchant = (g.merchant_raw || "").trim();
    return {
      txn_type: type,
      amount: num(g.amount),
      currency: (g.currency || "").toUpperCase() || null,
      card_last4: g.card || null,
      merchant_raw: merchant || null,
      balance_after: balance,
    };
  }
  throw new Error("unreachable");
}

const stripChars = (s: string, chars: string) => {
  let a = 0,
    b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

export function splitMerchant(
  raw: string | null,
  bank: string | null,
): [string | null, string | null, string | null] {
  if (typeof raw !== "string" || !raw.trim()) return [null, null, null];
  const s = raw.replace(/\s+/g, " ").trim();
  let m: RegExpExecArray | null;
  if (bank === "ADCB") {
    if ((m = /^(.*),\s*(.*?)-\s*([A-Z]{2})$/.exec(s)))
      return [m[1].trim(), m[2].trim() || null, m[3]];
    return [s, null, null];
  }
  if (bank === "Liv") {
    const k = s.lastIndexOf(", ");
    if (k >= 0) return [s.slice(0, k).trim(), s.slice(k + 2).trim(), null];
    return [s, null, null];
  }
  if (bank === "FAB") {
    m = /^(.*?)\s+([A-Z]{2})$/.exec(s);
    const [name, cc] = m ? [m[1].trim(), m[2]] : [s, null];
    const loc =
      /\s+((?:ABU ?DHABI|DUBAI|SHARJAH|AJMAN|AL AIN|RAS AL KHAIMAH|FUJAIRAH|RIYADH|JEDDAH|KARACHI|LAHORE|LONDON|CAIRO|[A-Z][a-z]+))$/i.exec(
        name,
      );
    if (loc && loc.index > 2)
      return [name.slice(0, loc.index).trim(), loc[1], cc];
    return [name, null, cc];
  }
  if (bank === "ADIB") {
    const UAE = T.UAE_CITIES;
    if ((m = /^(.*?) in (.*?), ?(UNITED ARAB EMI|UNITED STATES|.*)$/.exec(s)))
      return [
        m[1].trim(),
        m[2].trim() || null,
        m[3].includes("ARAB") ? "AE" : null,
      ];
    if ((m = /^(.*), ?(UAE|UNITED STATES|IRELAND|.*)$/.exec(s)))
      return [m[1].trim(), null, m[2] === "UAE" ? "AE" : null];
    if ((m = new RegExp(`^(.*?)\\s+${UAE}?\\s*([A-Z]{2})$`).exec(s))) {
      const loc = new RegExp(`${UAE}\\s*[A-Z]{2}$`).exec(s);
      return [m[1].trim(), loc ? loc[0].slice(0, -2).trim() : null, m[2]];
    }
    return [s, null, null];
  }
  return [s, null, null]; // Mashreq: no location
}

const BRANDS: [RegExp, string][] = T.BRANDS.map(([s, n]) => [rx(s, "i"), n]);
const FUEL = new Set<string>(T.FUEL_BRANDS);
const FOOD_AT_STATION = rx(T.FOOD_AT_STATION, "i");
const TRANSFER_MERCHANTS = rx(T.TRANSFER_MERCHANTS, "i");
const BNPL_MERCHANTS = rx(T.BNPL_MERCHANTS, "i");

/** Canonical brand name ("Talabat") or a cleaned upper-case merchant string. */
export function cleanName(name: string | null): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  for (const [re, canon] of BRANDS) {
    if (re.test(name)) {
      if (FUEL.has(canon) && FOOD_AT_STATION.test(name)) continue;
      return canon;
    }
  }
  let s = name.replace(/^(?:SP|FAT|WL|TAP|MYF|SQ|SUMUP|NOMOD)\s*\*\s*/i, "");
  s = s.replace(/\+?\d[\d -]{5,}/g, " ");
  s = s.replace(/\b\d+\b/g, " ");
  s = s.replace(/[*#/]+/g, " ");
  s = stripChars(s.replace(/\s+/g, " "), " -,.");
  return s.toUpperCase() || null;
}

const DEBIT = new Set<SmsType>([
  "purchase",
  "bill_payment",
  "cash_withdrawal",
  "bank_fee",
  "transfer_out",
  "card_repayment",
  "loan_repayment",
  "internal_out",
  "other_debit",
]);
const CREDIT = new Set<SmsType>([
  "refund",
  "transfer_in",
  "income",
  "internal_in",
  "card_payment_received",
]);

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
/** Transaction date written inside some templates (Mashreq 05-MAY-2025, ADCB 05/05/2025, FAB 05/05/25). */
export function dateInText(message: string): string | null {
  const p = (n: number | string) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => {
    const iso = `${y}-${p(m)}-${p(d)}`;
    return m >= 1 &&
      m <= 12 &&
      d >= 1 &&
      new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) === iso
      ? iso
      : null;
  };
  let m = /\b(\d{1,2})-([A-Z]{3})-(\d{4})\b/i.exec(message);
  if (m) {
    const month = MONTHS.indexOf(m[2].toUpperCase()) + 1;
    if (month) return valid(+m[3], month, +m[1]);
  }
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/.exec(message);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

/** Parse one SMS. Pass the bank when known (sender or detectBank); otherwise only OTP/declined/notice match. */
export function parseSms(message: string, bank: string | null): ParsedSms {
  const p = parseRaw(message, bank);
  const [merchant, location, country] = splitMerchant(p.merchant_raw, bank);
  let merchant_clean = cleanName(merchant);
  let txn_type = p.txn_type;
  if (
    (txn_type === "purchase" || txn_type === "bill_payment") &&
    merchant_clean == null
  )
    merchant_clean = "UNKNOWN MERCHANT";
  if (txn_type === "purchase" && TRANSFER_MERCHANTS.test(p.merchant_raw || ""))
    txn_type = "transfer_out";
  const rates = T.AED_PER_UNIT as Record<string, number>;
  const rate = p.currency != null ? rates[p.currency] : undefined;
  return {
    bank,
    ...p,
    txn_type,
    merchant,
    location,
    country,
    merchant_clean,
    direction: DEBIT.has(txn_type)
      ? "debit"
      : CREDIT.has(txn_type)
        ? "credit"
        : "none",
    amount_aed: rate != null && !Number.isNaN(p.amount) ? p.amount * rate : NaN,
    is_bnpl:
      txn_type === "purchase" && BNPL_MERCHANTS.test(p.merchant_raw || ""),
    is_foreign:
      p.currency != null &&
      (p.currency !== "AED" || (country != null && country !== "AE")),
    date_in_text: dateInText(message),
  };
}

/** The bank whose own templates match the most messages (first 400). */
export function detectBank(messages: string[]): string | null {
  let best: string | null = null,
    bestScore = 0;
  for (const b of BANK_NAMES) {
    let score = 0;
    for (const m of messages.slice(0, 400)) {
      const text = String(m).replace(/\n/g, " ").trim();
      if (BANKS[b].some(([t, re]) => t !== "notice" && re.test(text))) score++;
    }
    if (score > bestScore) [best, bestScore] = [b, score];
  }
  return best;
}
/** Best bank for a single message (its own templates first, then the batch guess). */
export function bankForMessage(
  message: string,
  fallback: string | null,
): string | null {
  const text = message.replace(/\n/g, " ").trim();
  const own = (b: string | null) =>
    !!b && BANKS[b]?.some(([t, re]) => t !== "notice" && re.test(text));
  if (own(fallback)) return fallback;
  return BANK_NAMES.find((b) => own(b)) ?? fallback;
}

const SENDER_BANK: [RegExp, string][] = [
  [/adcb/i, "ADCB"],
  [/^liv\b|liv\.?$|\bliv\b/i, "Liv"],
  [/mashreq|neo/i, "Mashreq"],
  [/\bfab\b|fabbank|first ?abu/i, "FAB"],
  [/adib/i, "ADIB"],
];
export function bankFromSender(
  address: string | null | undefined,
): string | null {
  for (const [re, b] of SENDER_BANK)
    if (re.test(String(address || ""))) return b;
  return null;
}

export interface RawSms {
  message: string;
  date: string | null;
  sender: string | null;
}

/** Pasted text: messages separated by blank lines (or one message per line when there are no blank lines). */
export function splitPastedSms(text: string): RawSms[] {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split("\n");
  return blocks
    .map((m) => m.trim())
    .filter(Boolean)
    .map((message) => ({ message, date: null, sender: null }));
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "SMS Backup & Restore" XML: received messages only (type 2 = sent). */
export function smsFromBackupXml(
  xml: string,
  parser: DOMParser = new DOMParser(),
): RawSms[] {
  const doc = parser.parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("This is not a valid SMS backup XML file.");
  return [...doc.getElementsByTagName("sms")]
    .filter((n) => n.getAttribute("type") !== "2")
    .map((n) => {
      const ms = Number(n.getAttribute("date"));
      return {
        message: (n.getAttribute("body") || "").trim(),
        date: Number.isFinite(ms) && ms > 0 ? localDate(new Date(ms)) : null,
        sender: n.getAttribute("address"),
      };
    })
    .filter((r) => r.message);
}

/** Mask long digit runs and emails for display. Parsing always runs on the original text. */
export function maskForDisplay(message: string): string {
  return message
    .replace(/\b(\d{2})\d{4,}(\d{2})\b/g, "$1••••$2")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "•••@•••");
}
