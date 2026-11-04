import PocketBase, { BaseAuthStore } from "pocketbase";
import type { Account, Category, Ledger, Transaction } from "./domain";
export interface Session {
  token: string;
  user: { id: string; email: string };
}
export type Table = "accounts" | "categories" | "transactions";
type RecordTypes = {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
};
export const IMPORT_BATCH_SIZE = 100;
type AuthResponse = { token: string; record: { id: string; email: string } };
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const storageKey = "fuloos.auth.v1";
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
        (response.status === 401 ||
          (response.status === 403 && path.endsWith("/auth-refresh"))) &&
        token === this.session?.token
      )
        this.publish(null);
      if (response.status === 404)
        throw new Error(
          "Fuloos backend is not configured yet. Install the PocketBase migration before using live accounts.",
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
      throw new Error(
        details ||
          data?.message ||
          `PocketBase request failed (${response.status}).`,
      );
    }
    return data as T;
  }
  private accept(data: AuthResponse): Session {
    const session = {
      token: data.token,
      user: { id: data.record.id, email: data.record.email },
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
          record: { id: data.record.id, email: data.record.email },
        }),
      );
  }
  async signIn(email: string, password: string): Promise<Session> {
    return this.accept(
      await this.request<AuthResponse>(
        "/api/collections/fuloos_users/auth-with-password",
        {
          method: "POST",
          body: JSON.stringify({ identity: email.trim(), password }),
        },
      ),
    );
  }
  async signUp(
    email: string,
    password: string,
  ): Promise<{ session: Session | null; verificationRequired: boolean }> {
    await this.request("/api/collections/fuloos_users/records", {
      method: "POST",
      body: JSON.stringify({
        email: email.trim(),
        password,
        passwordConfirm: password,
      }),
    });
    return {
      session: await this.signIn(email, password),
      verificationRequired: false,
    };
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
  async load(): Promise<Ledger> {
    if (!this.session) throw new Error("Please sign in.");
    const [accounts, categories, records] = await Promise.all([
      this.rows<Account>("accounts"),
      this.rows<Category>("categories"),
      this.rows<Transaction>("transactions"),
    ]);
    return {
      accounts,
      categories,
      transactions: records.map((t) => ({
        ...t,
        to_account_id: t.to_account_id || null,
        category_id: t.category_id || null,
      })),
    };
  }
  async save<K extends Table>(
    table: K,
    value: Record<string, unknown>,
    id?: string,
  ): Promise<RecordTypes[K]> {
    if (!this.session) throw new Error("Please sign in.");
    const session = this.session;
    const body: Record<string, unknown> = {
      ...value,
      user_id: this.session.user.id,
    };
    for (const key of ["to_account_id", "category_id"])
      if (body[key as keyof typeof body] === null)
        Object.assign(body, { [key]: "" });
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
    return table === "transactions"
      ? {
          ...record,
          to_account_id: (record as Transaction).to_account_id || null,
          category_id: (record as Transaction).category_id || null,
        }
      : record;
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
          requests: chunk.map((value) => {
            const body: Record<string, unknown> = {
              ...value,
              user_id: session.user.id,
            };
            for (const key of ["to_account_id", "category_id"])
              if (body[key] === null) body[key] = "";
            return {
              method: "POST",
              url: `/api/collections/fuloos_${table}/records`,
              body,
            };
          }),
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
        result.map((r) => r.body),
      );
    }
  }
  async remove(table: Table, id: string): Promise<void> {
    if (!this.session) throw new Error("Please sign in.");
    await this.request(
      `/api/collections/fuloos_${table}/records/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }
}

