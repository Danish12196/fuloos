import { useEffect, useState } from "react";

/**
 * How tightly lists are laid out. Compact is the spreadsheet-style table;
 * relaxed uses roomier, card-style rows. Stored per browser (no schema).
 */
export type Density = "compact" | "relaxed";

export const DENSITY_KEY = "fuloos-density";
export const DEFAULT_DENSITY: Density = "compact";

export function parseDensity(value: unknown): Density {
  return value === "relaxed" || value === "compact" ? value : DEFAULT_DENSITY;
}

function savedDensity(): Density {
  try {
    return parseDensity(localStorage.getItem(DENSITY_KEY));
  } catch {
    return DEFAULT_DENSITY;
  }
}

function applyDensity(density: Density) {
  document.documentElement.dataset.density = density;
}

const listeners = new Set<(d: Density) => void>();
let current: Density | null = null;

function read(): Density {
  if (current === null) {
    current = savedDensity();
    applyDensity(current);
  }
  return current;
}

export function setDensity(next: Density) {
  current = next;
  applyDensity(next);
  try {
    localStorage.setItem(DENSITY_KEY, next);
  } catch {
    // The choice still applies to this tab when storage is unavailable.
  }
  for (const l of listeners) l(next);
}

/** The current layout density, kept in sync across components and tabs. */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setLocal] = useState<Density>(read);
  useEffect(() => {
    listeners.add(setLocal);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DENSITY_KEY) return;
      current = parseDensity(e.newValue);
      applyDensity(current);
      for (const l of listeners) l(current);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(setLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [density, setDensity];
}
