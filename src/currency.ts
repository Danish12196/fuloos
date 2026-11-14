export const DEFAULT_CURRENCY = "AED" as const;

export type SupportedCurrencyCode =
  | "AED"
  | "USD"
  | "EUR"
  | "GBP"
  | "SAR"
  | "KWD"
  | "BHD"
  | "QAR"
  | "OMR"
  | "INR"
  | "PKR"
  | "PHP"
  | "EGP"
  | "JPY"
  | "CHF"
  | "CAD"
  | "AUD"
  | "SGD";

export interface CurrencyMeta {
  code: SupportedCurrencyCode;
  name: string;
  decimals: 0 | 2 | 3;
  /** Reference rate: 1 unit of this currency = X AED. User-overridable. */
  referenceRateToAed: number;
  pegged?: boolean;
}

export const REFERENCE_RATES_NOTE =
  "Reference rates only — override with your actual bank or card rate.";

export const SUPPORTED_CURRENCIES: readonly CurrencyMeta[] = [
  { code: "AED", name: "UAE Dirham", decimals: 2, referenceRateToAed: 1, pegged: true },
  { code: "USD", name: "US Dollar", decimals: 2, referenceRateToAed: 3.6725, pegged: true },
  { code: "EUR", name: "Euro", decimals: 2, referenceRateToAed: 3.98 },
  { code: "GBP", name: "British Pound", decimals: 2, referenceRateToAed: 4.66 },
  { code: "SAR", name: "Saudi Riyal", decimals: 2, referenceRateToAed: 0.9793, pegged: true },
  { code: "KWD", name: "Kuwaiti Dinar", decimals: 3, referenceRateToAed: 11.95 },
  { code: "BHD", name: "Bahraini Dinar", decimals: 3, referenceRateToAed: 9.74, pegged: true },
  { code: "QAR", name: "Qatari Riyal", decimals: 2, referenceRateToAed: 1.0089, pegged: true },
  { code: "OMR", name: "Omani Rial", decimals: 3, referenceRateToAed: 9.54, pegged: true },
  { code: "INR", name: "Indian Rupee", decimals: 2, referenceRateToAed: 0.0435 },
  { code: "PKR", name: "Pakistani Rupee", decimals: 2, referenceRateToAed: 0.0132 },
  { code: "PHP", name: "Philippine Peso", decimals: 2, referenceRateToAed: 0.064 },
  { code: "EGP", name: "Egyptian Pound", decimals: 2, referenceRateToAed: 0.075 },
  { code: "JPY", name: "Japanese Yen", decimals: 0, referenceRateToAed: 0.024 },
  { code: "CHF", name: "Swiss Franc", decimals: 2, referenceRateToAed: 4.18 },
  { code: "CAD", name: "Canadian Dollar", decimals: 2, referenceRateToAed: 2.65 },
  { code: "AUD", name: "Australian Dollar", decimals: 2, referenceRateToAed: 2.40 },
  { code: "SGD", name: "Singapore Dollar", decimals: 2, referenceRateToAed: 2.75 },
] as const;

const CURRENCY_MAP = new Map<string, CurrencyMeta>(
  SUPPORTED_CURRENCIES.map((c) => [c.code, c]),
);

const MAX_MINOR_UNITS = 100_000_000_000;
const MAX_FX_RATE = 1_000_000;

export function normalizeCurrencyCode(code: string | null | undefined): string {
  const trimmed = (code ?? "").trim().toUpperCase();
  return trimmed || DEFAULT_CURRENCY;
}

export function isSupportedCurrency(code: string): code is SupportedCurrencyCode {
  return CURRENCY_MAP.has(code.trim().toUpperCase());
}

export function getCurrencyMeta(code: string): CurrencyMeta | undefined {
  return CURRENCY_MAP.get(normalizeCurrencyCode(code));
}

export function getCurrencyDecimals(code: string): 0 | 2 | 3 {
  return getCurrencyMeta(code)?.decimals ?? 2;
}

export function getReferenceFxRate(code: string): number {
  return getCurrencyMeta(code)?.referenceRateToAed ?? 1;
}

/**
 * Parses a decimal string (e.g. "100.50", "1.250", "1500") into integer minor
 * units for the given currency (0, 2, or 3 decimal places).
 */
export function parseCurrencyMinor(value: string, currency: string): number {
  const code = normalizeCurrencyCode(currency);
  const meta = CURRENCY_MAP.get(code);
  if (!meta) {
    throw new Error(`Unsupported currency "${code}".`);
  }
  const trimmed = value.trim();
  const decimals = meta.decimals;
  const pattern =
    decimals === 0
      ? /^-?\d+$/
      : decimals === 3
        ? /^-?\d+(\.\d{1,3})?$/
        : /^-?\d+(\.\d{1,2})?$/;
  if (!pattern.test(trimmed)) {
    throw new Error(
      decimals === 0
        ? `Enter a whole number amount for ${code}.`
        : `Enter a valid ${code} amount with up to ${decimals} decimal places.`,
    );
  }
  const negative = trimmed.startsWith("-");
  const [whole, part = ""] = trimmed.replace("-", "").split(".");
  const factor = 10 ** decimals;
  const result =
    decimals === 0
      ? Number(whole)
      : Number(whole) * factor + Number(part.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_MINOR_UNITS) {
    throw new Error("Amount is too large.");
  }
  return result === 0 ? 0 : negative ? -result : result;
}

/**
 * Formats integer minor units as a plain decimal string suitable for inputs and CSV.
 */
export function formatCurrencyInput(minorUnits: number, currency: string): string {
  const decimals = getCurrencyDecimals(currency);
  const safe = Math.trunc(minorUnits);
  if (decimals === 0) return String(safe);
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const factor = 10 ** decimals;
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Converts integer minor units in `currency` to integer AED fils using an
 * explicit `fxRate` (where 1 major unit of `currency` = `fxRate` AED).
 */
export function convertToAedFils(
  originalMinorUnits: number,
  currency: string,
  fxRate: number,
): number {
  const code = normalizeCurrencyCode(currency);
  const meta = CURRENCY_MAP.get(code);
  if (!meta) {
    throw new Error(`Unsupported currency "${code}".`);
  }
  if (
    !Number.isSafeInteger(originalMinorUnits) ||
    originalMinorUnits < 0 ||
    originalMinorUnits > MAX_MINOR_UNITS
  ) {
    throw new Error("Original amount must be zero or greater.");
  }
  if (!Number.isFinite(fxRate) || fxRate <= 0 || fxRate > MAX_FX_RATE) {
    throw new Error("Exchange rate must be greater than zero.");
  }
  if (code === DEFAULT_CURRENCY && fxRate === 1) {
    return originalMinorUnits;
  }
  const factor = 10 ** meta.decimals;
  const aedFils = Math.round((originalMinorUnits * fxRate * 100) / factor);
  if (!Number.isSafeInteger(aedFils) || aedFils < 0 || aedFils > MAX_MINOR_UNITS) {
    throw new Error("Converted AED amount exceeds the supported limit.");
  }
  return aedFils;
}

/**
 * Formats integer minor units for display in the specified currency.
 */
export function formatCurrency(
  minorUnits: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = normalizeCurrencyCode(currency);
  const decimals = getCurrencyDecimals(code);
  const major = minorUnits / 10 ** decimals;
  try {
    return new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major);
  } catch {
    return `${code} ${formatCurrencyInput(minorUnits, code)}`;
  }
}

export function formatFxRate(fxRate: number): string {
  if (!Number.isFinite(fxRate) || fxRate <= 0) return "";
  return Number(fxRate.toFixed(6)).toString();
}

/**
 * Formats an original-currency pill like `USD 100.00 @ 3.6725`.
 */
export function formatOriginalCurrencyPill(
  originalMinorUnits: number,
  currency: string,
  fxRate?: number,
): string {
  const code = normalizeCurrencyCode(currency);
  const amountStr = formatCurrencyInput(originalMinorUnits, code);
  if (fxRate !== undefined && Number.isFinite(fxRate) && fxRate > 0) {
    return `${code} ${amountStr} @ ${formatFxRate(fxRate)}`;
  }
  return `${code} ${amountStr}`;
}

export function validateForeignCurrencyFields(fields: {
  original_amount?: number;
  original_currency?: string;
  fx_rate?: number;
}): void {
  const rawCode = fields.original_currency;
  if (rawCode === undefined || rawCode === null || rawCode === "") return;
  const code = rawCode.trim().toUpperCase();
  if (code === DEFAULT_CURRENCY) return;
  if (!isSupportedCurrency(code)) {
    throw new Error(`Unsupported currency "${rawCode}".`);
  }
  if (
    fields.original_amount === undefined ||
    !Number.isSafeInteger(fields.original_amount) ||
    fields.original_amount < 0 ||
    fields.original_amount > MAX_MINOR_UNITS
  ) {
    throw new Error(
      "Original amount must be zero or greater in the currency's minor units.",
    );
  }
  if (
    fields.fx_rate === undefined ||
    typeof fields.fx_rate !== "number" ||
    !Number.isFinite(fields.fx_rate) ||
    fields.fx_rate <= 0 ||
    fields.fx_rate > MAX_FX_RATE
  ) {
    throw new Error("Exchange rate must be greater than zero.");
  }
}
