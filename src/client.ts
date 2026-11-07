import { PocketBaseBackend } from "./backend";
import {
  createAccountPresetStore,
  createLocalPresetStore,
  type PresetStore,
} from "./csvPresets";
export type { Session } from "./backend";
const url = import.meta.env.VITE_POCKETBASE_URL;
let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  /* Private browsers can use an in-memory session. */
}
export const backend = url ? new PocketBaseBackend(url, storage) : null;

/** CSV presets sync to the signed-in account; demo and local-only modes keep them in this browser. */
export function createPresetStore(signedIn: boolean): PresetStore {
  const local = storage ?? null;
  if (!backend || !signedIn) return createLocalPresetStore(local);
  const remote = backend;
  return createAccountPresetStore(
    {
      list: () => remote.listCsvPresets(),
      save: (body, id) => remote.save("csv_presets", { ...body }, id),
      remove: (id) => remote.remove("csv_presets", id),
    },
    local,
  );
}
