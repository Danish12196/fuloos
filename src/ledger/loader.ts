/* Downloads the hashed Ledger model once per page load. The model is hosted outside this repository and only its
   URL is configured (VITE_LEDGER_MODEL_URL). Without it, SMS import still works with the brand and keyword rules. */
import { loadModel, type LoadedModel } from "./model.ts";

export type ModelState =
  | { status: "loading" }
  | { status: "ready"; model: LoadedModel }
  | { status: "off" }
  | { status: "failed"; error: string };

let pending: Promise<ModelState> | null = null;

export function modelUrl(): string {
  return (import.meta.env?.VITE_LEDGER_MODEL_URL ?? "").trim();
}

export function loadLedgerModel(): Promise<ModelState> {
  const url = modelUrl();
  if (!url) return Promise.resolve({ status: "off" });
  pending ??= fetch(url, { credentials: "omit" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Model download failed (${res.status}).`);
      return { status: "ready", model: loadModel(await res.json()) } as const;
    })
    .catch((e: unknown): ModelState => {
      pending = null;
      return {
        status: "failed",
        error: e instanceof Error ? e.message : "Model download failed.",
      };
    });
  return pending;
}
