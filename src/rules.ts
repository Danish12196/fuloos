import type {
  Category,
  Kind,
  RuleMatchField,
  RuleMatchType,
  TransactionRule,
} from "./domain.ts";
import { normalizeTags, validateTags } from "./enrichment.ts";

export const MAX_RULE_NAME_LENGTH = 80;
export const MAX_RULE_PATTERN_LENGTH = 200;
export const MAX_REGEX_PATTERN_LENGTH = 120;
export const MAX_MATCH_TEXT_LENGTH = 500;
export const MAX_RULE_PRIORITY = 10000;

const VALID_FIELDS = new Set<RuleMatchField>(["payee", "notes", "either"]);
const VALID_TYPES = new Set<RuleMatchType>([
  "contains",
  "starts_with",
  "exact",
  "regex",
]);

/**
 * Checks whether a regex pattern is syntactically valid and free of common
 * ReDoS constructs (nested quantifiers, backreferences, excessive length).
 */
export function isSafeRegexPattern(pattern: string): {
  ok: boolean;
  error?: string;
} {
  if (!pattern) {
    return { ok: false, error: "Regex pattern cannot be empty." };
  }
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `Regex pattern must be ${MAX_REGEX_PATTERN_LENGTH} characters or fewer.`,
    };
  }
  // Reject backreferences (\1 .. \9) which can cause exponential backtracking.
  if (/\\[1-9]/.test(pattern)) {
    return {
      ok: false,
      error: "Regex backreferences (e.g. \\1) are not supported.",
    };
  }
  // Reject groups containing a quantifier that are themselves quantified: e.g. (a+)+, (.*)*, ([a-z]+){2,}
  if (
    /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,?\d*\})(?:[^()\\]|\\.)*\)\s*(?:[+*?]|\{\d+,?\d*\})/.test(
      pattern,
    )
  ) {
    return {
      ok: false,
      error: "Nested quantifiers in regex are not allowed for safety.",
    };
  }
  try {
    new RegExp(pattern, "i");
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid regular expression syntax." };
  }
}

export function validateRule(
  rule: Omit<TransactionRule, "id"> & { id?: string },
  categories: ReadonlyArray<Category>,
): void {
  const name = rule.name?.trim() ?? "";
  if (!name || name.length > MAX_RULE_NAME_LENGTH) {
    throw new Error(
      `Rule name must be 1–${MAX_RULE_NAME_LENGTH} characters.`,
    );
  }
  if (
    !Number.isSafeInteger(rule.priority) ||
    rule.priority < 0 ||
    rule.priority > MAX_RULE_PRIORITY
  ) {
    throw new Error(`Priority must be an integer between 0 and ${MAX_RULE_PRIORITY}.`);
  }
  if (!VALID_FIELDS.has(rule.match_field)) {
    throw new Error("Choose a valid match field.");
  }
  if (!VALID_TYPES.has(rule.match_type)) {
    throw new Error("Choose a valid match type.");
  }
  const pattern = rule.pattern?.trim() ?? "";
  if (!pattern || pattern.length > MAX_RULE_PATTERN_LENGTH) {
    throw new Error(
      `Pattern must be 1–${MAX_RULE_PATTERN_LENGTH} characters.`,
    );
  }
  if (rule.match_type === "regex") {
    const check = isSafeRegexPattern(pattern);
    if (!check.ok) {
      throw new Error(check.error ?? "Unsafe regular expression.");
    }
  }
  if (rule.min_amount != null) {
    if (
      !Number.isSafeInteger(rule.min_amount) ||
      rule.min_amount < 0 ||
      rule.min_amount > 100_000_000_000
    ) {
      throw new Error("Minimum amount is out of range.");
    }
  }
  if (rule.max_amount != null) {
    if (
      !Number.isSafeInteger(rule.max_amount) ||
      rule.max_amount < 0 ||
      rule.max_amount > 100_000_000_000
    ) {
      throw new Error("Maximum amount is out of range.");
    }
  }
  if (
    rule.min_amount != null &&
    rule.max_amount != null &&
    rule.min_amount > 0 &&
    rule.max_amount > 0 &&
    rule.min_amount > rule.max_amount
  ) {
    throw new Error("Minimum amount cannot exceed maximum amount.");
  }
  if (
    rule.set_category_id &&
    !categories.some((c) => c.id === rule.set_category_id)
  ) {
    throw new Error("Selected rule category does not exist.");
  }
  const tags = validateTags(rule.add_tags ?? []);
  const payee = rule.set_payee?.trim() ?? "";
  if (payee.length > 160) {
    throw new Error("Payee replacement must be 160 characters or fewer.");
  }
  if (!rule.set_category_id && tags.length === 0 && !payee) {
    throw new Error(
      "Choose at least one action: set category, add tags, or set payee.",
    );
  }
}

export function sortRules(
  rules: ReadonlyArray<TransactionRule>,
): TransactionRule[] {
  return [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function matchesRule(
  rule: TransactionRule,
  tx: { payee?: string; notes?: string; amount?: number },
): boolean {
  if (!rule.enabled) return false;
  const pattern = rule.pattern.trim();
  if (!pattern) return false;

  const amount = tx.amount ?? 0;
  if (rule.min_amount != null && rule.min_amount > 0 && amount < rule.min_amount) {
    return false;
  }
  if (rule.max_amount != null && rule.max_amount > 0 && amount > rule.max_amount) {
    return false;
  }

  const candidates =
    rule.match_field === "payee"
      ? [tx.payee ?? ""]
      : rule.match_field === "notes"
        ? [tx.notes ?? ""]
        : [tx.payee ?? "", tx.notes ?? ""];

  if (rule.match_type === "regex") {
    const check = isSafeRegexPattern(pattern);
    if (!check.ok) return false;
    try {
      const re = new RegExp(pattern, "i");
      return candidates.some((c) => re.test(c.slice(0, MAX_MATCH_TEXT_LENGTH)));
    } catch {
      return false;
    }
  }

  const needle = pattern.toLowerCase();
  return candidates.some((raw) => {
    const hay = raw.slice(0, MAX_MATCH_TEXT_LENGTH).toLowerCase();
    if (rule.match_type === "contains") return hay.includes(needle);
    if (rule.match_type === "starts_with") return hay.startsWith(needle);
    if (rule.match_type === "exact") return hay.trim() === needle;
    return false;
  });
}

export interface ApplyRulesOptions {
  /** "all" (default) applies every matching rule in priority order; "first" stops after first match. */
  mode?: "first" | "all";
  /** Overwrite an existing category_id on the transaction. Default false. */
  overwriteCategory?: boolean;
  /** Overwrite an existing payee on the transaction. Default false. */
  overwritePayee?: boolean;
}

export interface ApplyRulesResult {
  category_id: string | null;
  payee: string;
  tags: string[];
  matchedRules: TransactionRule[];
}

export function applyRules(
  rules: ReadonlyArray<TransactionRule>,
  tx: {
    type?: Kind;
    payee?: string;
    notes?: string;
    amount?: number;
    category_id?: string | null;
    tags?: string[];
  },
  options: ApplyRulesOptions = {},
): ApplyRulesResult {
  const mode = options.mode ?? "all";
  const overwriteCategory = options.overwriteCategory ?? false;
  const overwritePayee = options.overwritePayee ?? false;

  let category_id: string | null = tx.category_id ?? null;
  let payee = tx.payee ?? "";
  let tags = normalizeTags(tx.tags ?? []);
  let categorySetByRule = false;
  let payeeSetByRule = false;
  const matchedRules: TransactionRule[] = [];

  for (const rule of sortRules(rules)) {
    if (!matchesRule(rule, tx)) continue;
    matchedRules.push(rule);

    if (
      rule.set_category_id &&
      tx.type !== "transfer" &&
      !categorySetByRule &&
      (!category_id || overwriteCategory)
    ) {
      category_id = rule.set_category_id;
      categorySetByRule = true;
    }

    const nextPayee = rule.set_payee?.trim() ?? "";
    if (
      nextPayee &&
      !payeeSetByRule &&
      (!payee.trim() || overwritePayee)
    ) {
      payee = nextPayee;
      payeeSetByRule = true;
    }

    if (rule.add_tags && rule.add_tags.length > 0) {
      tags = normalizeTags([...tags, ...rule.add_tags]);
    }

    if (mode === "first") break;
  }

  return { category_id, payee, tags, matchedRules };
}
