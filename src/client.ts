import { PocketBaseBackend } from "./backend";
export type { Session } from "./backend";
const url = import.meta.env.VITE_POCKETBASE_URL;
let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  /* Private browsers can use an in-memory session. */
}
export const backend = url ? new PocketBaseBackend(url, storage) : null;
