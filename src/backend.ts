import PocketBase, { BaseAuthStore } from "pocketbase";
import type { Account, Category, Ledger, Transaction } from "./domain";
export interface Session {
  token: string;
  user: { id: string; email: string };
}
export type Table = "accounts" | "categories" | "transactions";
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
  async save(
    table: Table,
    value: Record<string, unknown>,
    id?: string,
  ): Promise<void> {
    if (!this.session) throw new Error("Please sign in.");
    const body: Record<string, unknown> = {
      ...value,
      user_id: this.session.user.id,
    };
    for (const key of ["to_account_id", "category_id"])
      if (body[key as keyof typeof body] === null)
        Object.assign(body, { [key]: "" });
    await this.request(
      `/api/collections/fuloos_${table}/records${id ? "/" + encodeURIComponent(id) : ""}`,
      { method: id ? "PATCH" : "POST", body: JSON.stringify(body) },
    );
  }
  async remove(table: Table, id: string): Promise<void> {
    if (!this.session) throw new Error("Please sign in.");
    await this.request(
      `/api/collections/fuloos_${table}/records/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }
}
