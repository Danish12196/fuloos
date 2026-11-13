import PocketBase, { BaseAuthStore } from "pocketbase";
import {
  defaultNotificationPreferences,
  defaultRecurringPreferences,
  type Account,
  type Budget,
  type Category,
  type DigestDay,
  type Ledger,
  type NotificationPreferences,
  type RecurringOccurrenceRecord,
  type RecurringPreferences,
  type RecurringSchedule,
  type Transaction,
} from "./domain.ts";
export interface Session {
  token: string;
  user: {
    id: string;
    email: string;
    verified?: boolean;
    mfaEnabled?: boolean;
  };
}
export type Table =
  | "accounts"
  | "categories"
  | "transactions"
  | "recurring"
  | "recurring_occurrences"
  | "recurring_prefs"
  | "csv_presets"
  | "budgets"
  | "ml_settings"
  | "ml_examples"
  | "notification_prefs"
  | "notification_log";
export interface CsvPresetRecord {
  id: string;
  name: string;
  name_key: string;
  config: unknown;
}
type SavedRecurringPreferences = RecurringPreferences & { id: string };
type SavedNotificationPreferences = NotificationPreferences & { id: string };
export interface NotificationLogRecord {
  id: string;
  dedup_key: string;
  channel: string;
  event_type: string;
  period_key: string;
  subject?: string;
  sent_at?: string;
}
type RecordTypes = {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
  recurring: RecurringSchedule;
  recurring_occurrences: RecurringOccurrenceRecord;
  recurring_prefs: SavedRecurringPreferences;
  csv_presets: CsvPresetRecord;
  budgets: Budget;
  ml_settings: MlSettingsRecord;
  ml_examples: MlExampleRecord;
  notification_prefs: SavedNotificationPreferences;
  notification_log: NotificationLogRecord;
};
/** AI suggestion settings and correction log (see src/ledger/learning.ts). */
export interface MlSettingsRecord {
  id: string;
  learn_consent: boolean;
  share_consent?: boolean;
  consent_version: string;
  consent_at: string;
  category_map: unknown;
}
export interface MlExampleRecord {
  id: string;
  merchant_text: string;
  payee: string;
  amount: number;
  category_id: string | null;
  source: "sms" | "csv" | "manual";
  model_version: string;
  suggested_category: string;
  accepted: boolean;
  created?: string;
}
export const IMPORT_BATCH_SIZE = 100;
type AuthResponse = {
  token: string;
  record: {
    id: string;
    email: string;
    verified?: boolean;
    mfa_enabled?: boolean;
  };
};
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const storageKey = "fuloos.auth.v1";

/** A PocketBase error response, keeping the status and field codes for callers. */
export class BackendError extends Error {
  readonly status: number;
  readonly fields: Record<string, { code?: string; message?: string }>;
  constructor(
    message: string,
    status: number,
    fields: Record<string, { code?: string; message?: string }> = {},
  ) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.fields = fields;
  }
}
export class MissingCollectionError extends BackendError {}
export class MfaRequiredError extends BackendError {
  readonly mfaId: string;
  constructor(mfaId: string, message = "Multi-factor authentication required.") {
    super(message, 401);
    this.name = "MfaRequiredError";
    this.mfaId = mfaId;
  }
}
const MAX_DISMISSED_KEYS = 400;

function parseDismissedKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [
      ...new Set(raw.filter((v): v is string => typeof v === "string" && !!v)),
    ].slice(-MAX_DISMISSED_KEYS);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return [
          ...new Set(
            parsed.filter((v): v is string => typeof v === "string" && !!v),
          ),
        ].slice(-MAX_DISMISSED_KEYS);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function serializeDismissedKeys(raw: unknown): string {
  const list = parseDismissedKeys(raw);
  let encoded = JSON.stringify(list);
  while (encoded.length > 19500 && list.length > 0) {
    list.shift();
    encoded = JSON.stringify(list);
  }
  return encoded;
}

export class PocketBaseBackend {
  private session: Session | null = null;
  private listeners = new Set<(session: Session | null) => void>();
  readonly url: string;
  private storage?: StorageLike;
  private fetcher: typeof fetch;
  constructor(
    url: string,
    storage?: StorageLike,
    fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.storage = storage;
    this.fetcher = fetcher;
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)
      )
    )
      throw new Error("PocketBase must use HTTPS.");
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error(
        "Use the public PocketBase origin without credentials or query parameters.",
      );
    this.url = parsed.href.replace(/\/$/, "");
    try {
      const raw = this.storage?.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.token && saved.user?.id && saved.user?.email)
          this.session = saved;
      }
    } catch {
      this.session = null;
    }
  }
  private publish(session: Session | null) {
    this.session = session;
    try {
      if (session) this.storage?.setItem(storageKey, JSON.stringify(session));
      else this.storage?.removeItem(storageKey);
    } catch {
      /* In-memory sessions still work when storage is unavailable. */
    }
    for (const listener of this.listeners) listener(session);
  }
  subscribe(listener: (session: Session | null) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  signOut() {
    this.publish(null);
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.session?.token;
    const headers = new Headers(init.headers);
    if (init.body) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", token);
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      if (path === "/api/batch")
        throw new Error(
          "Could not confirm the batch result. It may have been saved. Reload the ledger before retrying.",
        );
      throw new Error(
        "Could not reach PocketBase. Check the connection and try again.",
      );
    }
    const data =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      if (
        response.status === 401 &&
        typeof data?.mfaId === "string" &&
        data.mfaId
      ) {
        throw new MfaRequiredError(
          data.mfaId,
          data?.message || "Multi-factor authentication required.",
        );
      }
      if (
        (response.status === 401 ||
          (response.status === 403 && path.endsWith("/auth-refresh"))) &&
        token &&
        token === this.session?.token
      )
        this.publish(null);
      if (response.status === 404)
        throw new MissingCollectionError(
          path.startsWith("/api/collections/fuloos_recurring")
            ? "Recurring features aren't installed on the server yet. Apply the recurring PocketBase migrations to enable them."
            : path === "/api/fuloos/sign-out-everywhere"
              ? "Sign out everywhere requires the PocketBase security hook (pocketbase/pb_hooks/fuloos_security.pb.js) on the server."
              : "Fuloos backend is not configured yet. Install the PocketBase migration before using live accounts.",
          404,
        );
      if (
        path === "/api/batch" &&
        response.status === 403 &&
        data?.message === "Batch requests are not allowed."
      )
        throw new Error(
          "Bulk changes are disabled on the server. Enable Batch requests in PocketBase Settings → Application with a maximum of at least 100 requests.",
        );
      if (path === "/api/batch" && data?.data?.requests) {
        const failures = Object.entries(data.data.requests) as [
          string,
          {
            response?: {
              message?: string;
              data?: Record<string, { message?: string }>;
            };
          },
        ][];
        const first = failures[0];
        if (first) {
          const details = Object.values(first[1].response?.data ?? {})
            .map((v) => v.message)
            .filter(Boolean)
            .join(" ");
          throw new Error(
            `Batch item ${Number(first[0]) + 1} failed: ${details || first[1].response?.message || "Invalid record."} No records in this batch were saved.`,
          );
        }
      }
      const details =
        data?.data && typeof data.data === "object"
          ? Object.values(data.data)
              .map((v: unknown) =>
                v && typeof v === "object" && "message" in v
                  ? String(v.message)
                  : "",
              )
              .filter(Boolean)
              .join(" ")
          : "";
      throw new BackendError(
        details ||
          data?.message ||
          `PocketBase request failed (${response.status}).`,
        response.status,
        data?.data && typeof data.data === "object" ? data.data : {},
      );
    }
    return data as T;
  }
  private accept(data: AuthResponse): Session {
    const user: Session["user"] = {
      id: data.record.id,
      email: data.record.email,
    };
    if (typeof data.record.verified === "boolean") {
      user.verified = data.record.verified;
    }
    if (typeof data.record.mfa_enabled === "boolean") {
      user.mfaEnabled = data.record.mfa_enabled;
    }
    const session = {
      token: data.token,
      user,
    };
    this.publish(session);
    return session;
  }
  async getSession(): Promise<Session | null> {
    if (!this.session) return null;
    const before = this.session.token;
    try {
      const result = await this.request<AuthResponse>(
        "/api/collections/fuloos_users/auth-refresh",
        { method: "POST" },
      );
      if (this.session?.token !== before) return this.session;
      return this.accept(result);
    } catch (e) {
      if (!this.session) return null;
      throw e;
    }
  }
  async googleEnabled(): Promise<boolean> {
    const methods = await this.request<{
      oauth2?: { enabled: boolean; providers: { name: string }[] };
    }>("/api/collections/fuloos_users/auth-methods");
    return (
      !!methods.oauth2?.enabled &&
      methods.oauth2.providers.some((provider) => provider.name === "google")
    );
  }
  signInWithGoogle(): Promise<Session> {
    // Invoke directly from the button click so the SDK can open its popup synchronously.
    // Keep the SDK auth store in memory; the existing app owns session persistence.
    const client = new PocketBase(this.url, new BaseAuthStore());
    return client
      .collection("fuloos_users")
      .authWithOAuth2({ provider: "google" })
      .then((data) =>
        this.accept({
          token: data.token,
          record: {
            id: data.record.id,
            email: data.record.email,
            verified:
              typeof data.record.verified === "boolean"
                ? data.record.verified
                : undefined,
            mfa_enabled:
              typeof data.record.mfa_enabled === "boolean"
                ? data.record.mfa_enabled
                : undefined,
          },
        }),
      );
  }
  async signIn(email: string, password: string): Promise<Session> {
    let data: AuthResponse;
    try {
      data = await this.request<AuthResponse>(
        "/api/collections/fuloos_users/auth-with-password",
        {
          method: "POST",
          body: JSON.stringify({ identity: email.trim(), password }),
        },
      );
    } catch (e) {
      if (e instanceof MfaRequiredError) throw e;
      if (e instanceof BackendError && e.status === 400)
        throw new BackendError("Incorrect email or password.", 400, e.fields);
      throw e;
    }
    return this.accept(data);
  }
  async requestOtp(email: string): Promise<{ otpId: string }> {
    const data = await this.request<{ otpId?: string }>(
      "/api/collections/fuloos_users/request-otp",
      {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      },
    );
    if (!data?.otpId) {
      throw new BackendError(
        "Could not start email verification code. Check server OTP and SMTP settings.",
        400,
      );
    }
    return { otpId: data.otpId };
  }
  async verifyMfaOtp(
    mfaId: string,
    otpId: string,
    code: string,
  ): Promise<Session> {
    let data: AuthResponse;
    try {
      data = await this.request<AuthResponse>(
        "/api/collections/fuloos_users/auth-with-otp",
        {
          method: "POST",
          body: JSON.stringify({ mfaId, otpId, password: code.trim() }),
        },
      );
    } catch (e) {
      if (e instanceof BackendError && e.status === 400) {
        throw new BackendError(
          "Invalid or expired verification code.",
          400,
          e.fields,
        );
      }
      throw e;
    }
    return this.accept(data);
  }
  async requestPasswordReset(email: string): Promise<void> {
    await this.request("/api/collections/fuloos_users/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email: email.trim() }),
    });
  }
  async confirmPasswordReset(
    token: string,
    password: string,
    passwordConfirm: string,
  ): Promise<void> {
    await this.request("/api/collections/fuloos_users/confirm-password-reset", {
      method: "POST",
      body: JSON.stringify({ token: token.trim(), password, passwordConfirm }),
    });
  }
  async requestVerification(email: string): Promise<void> {
    await this.request("/api/collections/fuloos_users/request-verification", {
      method: "POST",
      body: JSON.stringify({ email: email.trim() }),
    });
  }
  async confirmVerification(token: string): Promise<void> {
    await this.request("/api/collections/fuloos_users/confirm-verification", {
      method: "POST",
      body: JSON.stringify({ token: token.trim() }),
    });
    if (this.session) {
      await this.getSession().catch(() => null);
    }
  }
  async changePassword(
    oldPassword: string,
    password: string,
    passwordConfirm: string,
  ): Promise<void> {
    if (!this.session) throw new Error("Please sign in.");
    await this.request(
      `/api/collections/fuloos_users/records/${encodeURIComponent(this.session.user.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ oldPassword, password, passwordConfirm }),
      },
    );
  }
  async requestEmailChange(newEmail: string): Promise<void> {
    if (!this.session) throw new Error("Please sign in.");
    await this.request("/api/collections/fuloos_users/request-email-change", {
      method: "POST",
      body: JSON.stringify({ newEmail: newEmail.trim() }),
    });
  }
  async confirmEmailChange(token: string, password: string): Promise<void> {
    await this.request("/api/collections/fuloos_users/confirm-email-change", {
      method: "POST",
      body: JSON.stringify({ token: token.trim(), password }),
    });
    if (this.session) this.signOut();
  }
  async setMfaEnabled(enabled: boolean): Promise<Session> {
    if (!this.session) throw new Error("Please sign in.");
    const record = await this.request<{
      id: string;
      email: string;
      verified?: boolean;
      mfa_enabled?: boolean;
    }>(
      `/api/collections/fuloos_users/records/${encodeURIComponent(this.session.user.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ mfa_enabled: enabled }),
      },
    );
    const updated: Session = {
      token: this.session.token,
      user: {
        ...this.session.user,
        email: record.email ?? this.session.user.email,
        verified:
          typeof record.verified === "boolean"
            ? record.verified
            : this.session.user.verified,
        mfaEnabled:
          typeof record.mfa_enabled === "boolean"
            ? record.mfa_enabled
            : enabled,
      },
    };
    this.publish(updated);
    return updated;
  }
  async signOutEverywhere(): Promise<void> {
    if (!this.session) throw new Error("Please sign in.");
    await this.request("/api/fuloos/sign-out-everywhere", {
      method: "POST",
    });
    this.signOut();
  }
  async signUp(
    email: string,
    password: string,
  ): Promise<{ session: Session | null; verificationRequired: boolean }> {
    try {
      await this.request("/api/collections/fuloos_users/records", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
          passwordConfirm: password,
        }),
      });
    } catch (e) {
      if (
        e instanceof BackendError &&
        e.fields.email?.code === "validation_not_unique"
      )
        throw new BackendError(
          "An account with this email already exists. Sign in instead.",
          e.status,
          e.fields,
        );
      throw e;
    }
    try {
      return {
        session: await this.signIn(email, password),
        verificationRequired: false,
      };
    } catch (e) {
      if (e instanceof BackendError && (e.status === 400 || e.status === 403)) {
        return { session: null, verificationRequired: true };
      }
      throw e;
    }
  }
  private async rows<T>(table: Table): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const result = await this.request<{ items: T[]; totalPages: number }>(
        `/api/collections/fuloos_${table}/records?page=${page}&perPage=200&sort=id`,
      );
      items.push(...result.items);
      if (page >= result.totalPages) break;
    }
    return items;
  }
  private async optionalRows<T>(table: Table): Promise<T[]> {
    try {
      return await this.rows<T>(table);
    } catch (e) {
      if (e instanceof MissingCollectionError) return [];
      throw e;
    }
  }
  /** Every record of an owner-only collection (throws MissingCollectionError when it isn't installed). */
  async list<K extends "ml_settings" | "ml_examples">(
    table: K,
  ): Promise<RecordTypes[K][]> {
    if (!this.session) throw new Error("Please sign in.");
    const rows = await this.rows<RecordTypes[K]>(table);
    return rows.map((r) => this.normalize(table, r));
  }
  async listCsvPresets(): Promise<CsvPresetRecord[]> {
    if (!this.session) throw new Error("Please sign in.");
    return this.rows<CsvPresetRecord>("csv_presets");
  }
  /** Checks whether a fuloos_* collection is installed on the server. */
  async probeCollection(table: Table): Promise<boolean> {
    if (!this.session) throw new Error("Please sign in.");
    try {
      await this.request(
        `/api/collections/fuloos_${table}/records?page=1&perPage=1&fields=id`,
      );
      return true;
    } catch (e) {
      if (e instanceof MissingCollectionError) return false;
      throw e;
    }
  }
  async load(): Promise<Ledger> {
    if (!this.session) throw new Error("Please sign in.");
    const [
      accounts,
      categories,
      records,
      recurring,
      recurringOccurrences,
      recurringPrefs,
      budgets,
    ] = await Promise.all([
      this.rows<Account>("accounts"),
      this.rows<Category>("categories"),
      this.rows<Transaction>("transactions"),
      this.optionalRows<RecurringSchedule>("recurring"),
      this.optionalRows<RecurringOccurrenceRecord>("recurring_occurrences"),
      this.optionalRows<SavedRecurringPreferences>("recurring_prefs"),
      this.optionalRows<Budget>("budgets"),
    ]);
    return {
      accounts,
      categories,
      transactions: records.map((t) => this.normalize("transactions", t)),
      recurring: recurring.map((r) => this.normalize("recurring", r)),
      recurring_occurrences: recurringOccurrences.map((o) =>
        this.normalize("recurring_occurrences", o),
      ),
      recurring_prefs: recurringPrefs[0]
        ? this.normalize("recurring_prefs", recurringPrefs[0])
        : { ...defaultRecurringPreferences },
      budgets: budgets.map((b) => this.normalize("budgets", b)),
    };
  }
  private prepareBody<K extends Table>(
    table: K,
    value: Record<string, unknown>,
    userId: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      ...value,
      user_id: userId,
    };
    for (const key of [
      "to_account_id",
      "category_id",
      "end_date",
      "match_source",
      "match_reason",
      "end_month",
    ]) {
      if (body[key] === null) body[key] = "";
    }
    if (table === "recurring_prefs" && "dismissed_keys" in body) {
      body.dismissed_keys = serializeDismissedKeys(body.dismissed_keys);
    }
    return body;
  }
  async save<K extends Table>(
    table: K,
    value: Record<string, unknown>,
    id?: string,
  ): Promise<RecordTypes[K]> {
    if (!this.session) throw new Error("Please sign in.");
    const session = this.session;
    const body = this.prepareBody(table, value, session.user.id);
    const record = await this.request<RecordTypes[K]>(
      `/api/collections/fuloos_${table}/records${id ? "/" + encodeURIComponent(id) : ""}`,
      { method: id ? "PATCH" : "POST", body: JSON.stringify(body) },
    );
    if (this.session?.user.id !== session.user.id)
      throw new Error("Session changed. Please sign in again.");
    return this.normalize(table, record);
  }
  private normalize<K extends Table>(
    table: K,
    record: RecordTypes[K],
  ): RecordTypes[K] {
    if (table === "transactions") {
      const tx = record as Transaction;
      return {
        ...tx,
        to_account_id: tx.to_account_id || null,
        category_id: tx.category_id || null,
      } as RecordTypes[K];
    }
    if (table === "recurring") {
      const r = record as RecurringSchedule;
      return {
        ...r,
        category_id: r.category_id || null,
        end_date: r.end_date || null,
      } as RecordTypes[K];
    }
    if (table === "recurring_occurrences") {
      const occ = record as RecurringOccurrenceRecord & {
        match_source?: string;
        match_reason?: string;
      };
      const normalized: RecurringOccurrenceRecord = { ...occ };
      if (occ.match_source === "auto" || occ.match_source === "manual") {
        normalized.match_source = occ.match_source;
      } else {
        delete normalized.match_source;
      }
      if (occ.match_reason) {
        normalized.match_reason = String(occ.match_reason);
      } else {
        delete normalized.match_reason;
      }
      return normalized as RecordTypes[K];
    }
    if (table === "ml_examples") {
      const e = record as MlExampleRecord;
      return { ...e, category_id: e.category_id || null } as RecordTypes[K];
    }
    if (table === "budgets") {
      const b = record as Budget;
      return {
        id: b.id,
        category_id: b.category_id,
        amount: b.amount,
        start_month: b.start_month,
        end_month: b.end_month || null,
      } as RecordTypes[K];
    }
    if (table === "recurring_prefs") {
      const pref = record as {
        id: string;
        auto_detect?: string;
        auto_match?: string;
        dismissed_keys?: unknown;
      };
      return {
        id: pref.id,
        auto_detect: pref.auto_detect === "off" ? "off" : "on",
        auto_match:
          pref.auto_match === "review" || pref.auto_match === "off"
            ? pref.auto_match
            : "auto",
        dismissed_keys: parseDismissedKeys(pref.dismissed_keys),
      } as RecordTypes[K];
    }
    if (table === "notification_prefs") {
      const p = record as Partial<SavedNotificationPreferences>;
      const validDays: readonly DigestDay[] = [
        "sun",
        "mon",
        "tue",
        "wed",
        "thu",
        "fri",
        "sat",
      ];
      const days = Number(p.upcoming_bill_days);
      return {
        id: String(p.id ?? ""),
        email_enabled: Boolean(p.email_enabled),
        upcoming_bill_enabled: Boolean(p.upcoming_bill_enabled),
        upcoming_bill_days:
          Number.isInteger(days) && days >= 1 && days <= 30 ? days : 3,
        overdue_enabled: Boolean(p.overdue_enabled),
        budget_80_enabled: Boolean(p.budget_80_enabled),
        budget_100_enabled: Boolean(p.budget_100_enabled),
        weekly_digest_enabled: Boolean(p.weekly_digest_enabled),
        digest_day: validDays.includes(p.digest_day as DigestDay)
          ? (p.digest_day as DigestDay)
          : "sun",
        timezone:
          typeof p.timezone === "string" && p.timezone.trim()
            ? p.timezone.trim()
            : "Asia/Dubai",
        channels:
          p.channels && typeof p.channels === "object"
            ? (p.channels as Record<string, boolean>)
            : { email: Boolean(p.email_enabled) },
      } as RecordTypes[K];
    }
    return record;
  }
  async updateTransactions(
    values: Transaction[],
    progress: (saved: number, records: Transaction[]) => void,
    shouldContinue: () => boolean = () => true,
  ): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("Please sign in.");
    for (let offset = 0; offset < values.length; offset += IMPORT_BATCH_SIZE) {
      if (this.session?.user.id !== session.user.id || !shouldContinue())
        throw new Error("Session changed. Reload the ledger before retrying.");
      const chunk = values.slice(offset, offset + IMPORT_BATCH_SIZE);
      const result = await this.request<
        { status: number; body: Transaction }[]
      >("/api/batch", {
        method: "POST",
        body: JSON.stringify({
          requests: chunk.map((t) => ({
            method: "PATCH",
            url: `/api/collections/fuloos_transactions/records/${encodeURIComponent(t.id)}`,
            body: {
              type: t.type,
              amount: t.amount,
              account_id: t.account_id,
              to_account_id: t.to_account_id || "",
              category_id: t.category_id || "",
              date: t.date,
              payee: t.payee,
              notes: t.notes,
              user_id: session.user.id,
            },
          })),
        }),
      });
      if (
        !Array.isArray(result) ||
        result.length !== chunk.length ||
        result.some(
          (r, i) =>
            r.status < 200 || r.status >= 300 || r.body?.id !== chunk[i].id,
        )
      )
        throw new Error(
          "The server returned an unexpected batch result. Reload the ledger before retrying.",
        );
      if (this.session?.user.id !== session.user.id || !shouldContinue())
        throw new Error("Session changed. Reload the ledger before retrying.");
      progress(
        offset + chunk.length,
        result.map((r) => this.normalize("transactions", r.body)),
      );
    }
  }
  async createMany<K extends Table>(
    table: K,
    values: Omit<RecordTypes[K], "id">[],
    progress: (saved: number, records: RecordTypes[K][]) => void,
    shouldContinue: () => boolean = () => true,
  ): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("Please sign in.");
    for (let offset = 0; offset < values.length; offset += IMPORT_BATCH_SIZE) {
      if (this.session?.user.id !== session.user.id || !shouldContinue())
        throw new Error("Session changed. Please sign in again.");
      const chunk = values.slice(offset, offset + IMPORT_BATCH_SIZE);
      const result = await this.request<
        { status: number; body: RecordTypes[K] }[]
      >("/api/batch", {
        method: "POST",
        body: JSON.stringify({
          requests: chunk.map((value) => ({
            method: "POST",
            url: `/api/collections/fuloos_${table}/records`,
            body: this.prepareBody(
              table,
              value as Record<string, unknown>,
              session.user.id,
            ),
          })),
        }),
      });
      if (
        !Array.isArray(result) ||
        result.length !== chunk.length ||
        result.some((r) => r.status < 200 || r.status >= 300 || !r.body?.id)
      )
        throw new Error(
          "The server returned an unexpected batch result. Reload the ledger before retrying.",
        );
      if (this.session?.user.id !== session.user.id || !shouldContinue())
        throw new Error("Session changed. Reload the ledger before retrying.");
      progress(
        offset + chunk.length,
        result.map((r) => this.normalize(table, r.body)),
      );
    }
  }
  private async recordIds(collection: string): Promise<string[]> {
    const ids: string[] = [];
    try {
      for (let page = 1; ; page++) {
        const result = await this.request<{
          items: { id: string }[];
          totalPages: number;
        }>(
          `/api/collections/${collection}/records?page=${page}&perPage=500&sort=id&fields=id`,
        );
        ids.push(...result.items.map((r) => r.id));
        if (page >= result.totalPages) break;
      }
    } catch (e) {
      if (e instanceof MissingCollectionError) return [];
      throw e;
    }
    return ids;
  }
  /**
   * Permanently deletes the signed-in user and everything they own.
   * Recurring schedules (and with them their confirmed occurrences) and transactions go first,
   * because the server refuses to delete accounts or categories that still have them.
   * Deleting the user then cascades to accounts, categories, budgets, presets and AI data.
   * Safe to retry: a partial run only leaves fewer records to remove next time.
   */
  async deleteAccount(
    progress: (step: string) => void = () => {},
  ): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("Please sign in.");
    const deleteUser = () =>
      this.request(
        `/api/collections/fuloos_users/records/${encodeURIComponent(session.user.id)}`,
        { method: "DELETE" },
      );
    // Try the user first: nothing is removed if the server doesn't allow self-delete yet,
    // and an account with no transactions or schedules is deleted in one request.
    progress("Deleting your account…");
    try {
      await deleteUser();
      this.publish(null);
      return;
    } catch (e) {
      if (e instanceof BackendError && e.status === 403)
        throw new Error(
          "Account deletion isn't enabled on the server yet. Apply the latest PocketBase migration and try again. Nothing was deleted.",
        );
      if (!(e instanceof BackendError) || e.status !== 400) throw e;
      // 400: a delete guard blocked the cascade. Remove what the guards protect, then retry.
    }
    for (const [collection, label] of [
      ["fuloos_recurring", "recurring schedules"],
      ["fuloos_transactions", "transactions"],
    ] as const) {
      const ids = await this.recordIds(collection);
      for (let offset = 0; offset < ids.length; offset += IMPORT_BATCH_SIZE) {
        if (this.session?.user.id !== session.user.id)
          throw new Error("Session changed. Sign in again to finish deleting.");
        progress(`Deleting ${label} (${offset} of ${ids.length})…`);
        await this.request("/api/batch", {
          method: "POST",
          body: JSON.stringify({
            requests: ids
              .slice(offset, offset + IMPORT_BATCH_SIZE)
              .map((id) => ({
                method: "DELETE",
                url: `/api/collections/${collection}/records/${encodeURIComponent(id)}`,
              })),
          }),
        });
      }
    }
    progress("Deleting your account…");
    await deleteUser();
    this.publish(null);
  }
  /**
   * Deletes records in batches of IMPORT_BATCH_SIZE. Each batch is all-or-nothing on the server;
   * `progress` reports the ids confirmed deleted so far so callers can keep local state in step.
   */
  async removeMany(
    table: Table,
    ids: string[],
    progress: (deleted: string[]) => void = () => {},
  ): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("Please sign in.");
    for (let offset = 0; offset < ids.length; offset += IMPORT_BATCH_SIZE) {
      if (this.session?.user.id !== session.user.id)
        throw new Error("Session changed. Reload the ledger before retrying.");
      const chunk = ids.slice(offset, offset + IMPORT_BATCH_SIZE);
      const result = await this.request<{ status: number }[]>("/api/batch", {
        method: "POST",
        body: JSON.stringify({
          requests: chunk.map((id) => ({
            method: "DELETE",
            url: `/api/collections/fuloos_${table}/records/${encodeURIComponent(id)}`,
          })),
        }),
      });
      if (
        !Array.isArray(result) ||
        result.length !== chunk.length ||
        result.some((r) => r.status < 200 || r.status >= 300)
      )
        throw new Error(
          "The server returned an unexpected batch result. Reload the ledger before retrying.",
        );
      progress(chunk);
    }
  }
  async remove(table: Table, id: string): Promise<void> {
    if (!this.session) throw new Error("Please sign in.");
    await this.request(
      `/api/collections/fuloos_${table}/records/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }
  /** Loads notification preferences, tolerating a missing collection on un-migrated servers. */
  async loadNotificationPrefs(): Promise<{
    prefs: NotificationPreferences;
    supported: boolean;
  }> {
    if (!this.session) throw new Error("Please sign in.");
    try {
      const rows = await this.rows<SavedNotificationPreferences>(
        "notification_prefs",
      );
      return {
        prefs: rows[0]
          ? this.normalize("notification_prefs", rows[0])
          : { ...defaultNotificationPreferences },
        supported: true,
      };
    } catch (e) {
      if (e instanceof MissingCollectionError) {
        return { prefs: { ...defaultNotificationPreferences }, supported: false };
      }
      throw e;
    }
  }
  async saveNotificationPrefs(
    prefs: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    if (!this.session) throw new Error("Please sign in.");
    const days = Math.max(
      1,
      Math.min(30, Math.round(Number(prefs.upcoming_bill_days) || 3)),
    );
    const body = {
      email_enabled: Boolean(prefs.email_enabled),
      upcoming_bill_enabled: Boolean(prefs.upcoming_bill_enabled),
      upcoming_bill_days: days,
      overdue_enabled: Boolean(prefs.overdue_enabled),
      budget_80_enabled: Boolean(prefs.budget_80_enabled),
      budget_100_enabled: Boolean(prefs.budget_100_enabled),
      weekly_digest_enabled: Boolean(prefs.weekly_digest_enabled),
      digest_day: prefs.digest_day || "sun",
      timezone: prefs.timezone.trim() || "Asia/Dubai",
      channels: {
        ...(prefs.channels ?? {}),
        email: Boolean(prefs.email_enabled),
      },
    };
    return this.save("notification_prefs", body, prefs.id || undefined);
  }
  async sendTestNotificationEmail(): Promise<{ ok: boolean; message: string }> {
    if (!this.session) throw new Error("Please sign in.");
    return this.request<{ ok: boolean; message: string }>(
      "/api/fuloos/notify-test",
      { method: "POST" },
    );
  }
}
