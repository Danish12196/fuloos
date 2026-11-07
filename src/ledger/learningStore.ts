/* Where the learning settings and correction log live: the signed-in account (fuloos_ml_settings /
   fuloos_ml_examples, owner-only rules) or, in demo mode and on servers without those collections, this browser
   session only (memory, gone on refresh). */
import {
  CONSENT_VERSION,
  defaultLearningSettings,
  mapFromStored,
  mapToStored,
  type LearningExample,
  type LearningSettings,
} from "./learning.ts";
import type { CategoryMap } from "./mapping.ts";

export interface LearningData {
  settings: LearningSettings;
  /** Oldest first. Empty when learning is off. */
  examples: LearningExample[];
  /** The stored mapping (null when the user never saved one). */
  storedMap: CategoryMap | null;
}

export interface LearningStore {
  readonly scope: "account" | "session";
  load(categoryIds: Set<string>): Promise<LearningData>;
  saveSettings(settings: LearningSettings): Promise<LearningSettings>;
  addExamples(examples: LearningExample[]): Promise<void>;
  /** Deletes the whole correction log; returns how many rows were removed. */
  clearExamples(): Promise<number>;
}

/** Turning learning on records consent; turning it off keeps the version/date of the last consent. */
export function withConsent(
  settings: LearningSettings,
  on: boolean,
  now = new Date(),
): LearningSettings {
  return on
    ? {
        ...settings,
        learn_consent: true,
        consent_version: CONSENT_VERSION,
        consent_at: now.toISOString(),
      }
    : { ...settings, learn_consent: false };
}

export function createSessionLearningStore(): LearningStore {
  let settings: LearningSettings | null = null;
  let examples: LearningExample[] = [];
  return {
    scope: "session",
    async load(categoryIds) {
      const s = settings ?? defaultLearningSettings();
      return {
        settings: s,
        examples: s.learn_consent
          ? examples.filter(
              (e) => !e.category_id || categoryIds.has(e.category_id),
            )
          : [],
        storedMap: settings ? s.category_map : null,
      };
    },
    async saveSettings(next) {
      settings = { ...next };
      return settings;
    },
    async addExamples(list) {
      examples = [...examples, ...list].slice(-5000);
    },
    async clearExamples() {
      const n = examples.length;
      examples = [];
      return n;
    },
  };
}

/** The subset of PocketBaseBackend this store needs (kept small so tests can fake it). */
export interface LearningRemote {
  listSettings(): Promise<
    {
      id: string;
      learn_consent: boolean;
      consent_version: string;
      consent_at: string;
      category_map: unknown;
    }[]
  >;
  saveSettings(
    body: Record<string, unknown>,
    id?: string,
  ): Promise<{ id: string }>;
  listExamples(): Promise<(LearningExample & { id: string })[]>;
  createExamples(list: LearningExample[]): Promise<void>;
  removeExamples(ids: string[]): Promise<void>;
}

export function createAccountLearningStore(
  remote: LearningRemote,
): LearningStore {
  let settingsId: string | undefined;
  return {
    scope: "account",
    async load(categoryIds) {
      const [row] = await remote.listSettings();
      settingsId = row?.id;
      const storedMap = row
        ? mapFromStored(row.category_map, categoryIds)
        : null;
      const settings: LearningSettings = row
        ? {
            id: row.id,
            learn_consent: !!row.learn_consent,
            consent_version: row.consent_version ?? "",
            consent_at: row.consent_at ?? "",
            category_map: storedMap ?? {},
          }
        : defaultLearningSettings();
      const examples = settings.learn_consent
        ? (await remote.listExamples()).sort((a, b) =>
            (a.created ?? "").localeCompare(b.created ?? ""),
          )
        : [];
      return { settings, examples, storedMap };
    },
    async saveSettings(next) {
      const saved = await remote.saveSettings(
        {
          learn_consent: next.learn_consent,
          consent_version: next.consent_version,
          consent_at: next.consent_at,
          category_map: mapToStored(next.category_map),
        },
        settingsId,
      );
      settingsId = saved.id;
      return { ...next, id: saved.id };
    },
    async addExamples(list) {
      if (list.length) await remote.createExamples(list);
    },
    async clearExamples() {
      const ids = (await remote.listExamples()).map((e) => e.id);
      if (ids.length) await remote.removeExamples(ids);
      return ids.length;
    },
  };
}
