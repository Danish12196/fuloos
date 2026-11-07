import { MissingCollectionError, PocketBaseBackend } from "./backend";
import {
  createAccountLearningStore,
  createSessionLearningStore,
  type LearningStore,
} from "./ledger/learningStore";
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

/** AI learning settings and correction log: the signed-in account, else this browser session only. */
export function createLearningStore(signedIn: boolean): LearningStore {
  if (!backend || !signedIn) return createSessionLearningStore();
  const api = backend;
  const account = createAccountLearningStore({
    listSettings: () => api.list("ml_settings"),
    saveSettings: (body, id) => api.save("ml_settings", body, id),
    listExamples: async () =>
      (await api.list("ml_examples")).map((e) => ({
        ...e,
        payee: e.payee ?? "",
        model_version: e.model_version ?? "",
        suggested_category: e.suggested_category ?? "",
      })),
    createExamples: (list) =>
      api.createMany(
        "ml_examples",
        list.map((e) => ({ ...e, created: undefined })),
        () => {},
      ),
    removeExamples: (ids) => api.removeMany("ml_examples", ids),
  });
  // Servers without the lockdown migration fall back to session-only learning.
  let fallback: LearningStore | null = null;
  const pick = () => fallback ?? account;
  return {
    get scope() {
      return pick().scope;
    },
    async load(ids) {
      try {
        return await pick().load(ids);
      } catch (e) {
        if (!(e instanceof MissingCollectionError)) throw e;
        fallback = createSessionLearningStore();
        return fallback.load(ids);
      }
    },
    saveSettings: (s) => pick().saveSettings(s),
    addExamples: (l) => pick().addExamples(l),
    clearExamples: () => pick().clearExamples(),
  };
}
