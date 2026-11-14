import { MissingCollectionError, type Table } from "./backend.ts";

export const EXPECTED_COLLECTIONS: readonly Table[] = [
  "accounts",
  "categories",
  "transactions",
  "recurring",
  "recurring_occurrences",
  "recurring_prefs",
  "csv_presets",
  "budgets",
  "goals",
  "goal_contributions",
  "ml_settings",
  "ml_examples",
  "rules",
];

export interface SchemaStatus {
  checked: boolean;
  ok: boolean;
  missing: string[];
}

export function collectionName(table: Table): string {
  return `fuloos_${table}`;
}

export function summarizeSchemaStatus(
  results: ReadonlyArray<{ table: Table; exists: boolean }>,
): SchemaStatus {
  const missing = results
    .filter((r) => !r.exists)
    .map((r) => collectionName(r.table));
  return {
    checked: true,
    ok: missing.length === 0,
    missing,
  };
}

export function formatMissingCollections(missing: readonly string[]): string {
  if (missing.length === 0) return "";
  if (missing.length <= 3) return missing.join(", ");
  return `${missing.slice(0, 3).join(", ")} (+${missing.length - 3} more)`;
}

export async function checkSchemaStatus(
  probe: (table: Table) => Promise<boolean>,
  tables: readonly Table[] = EXPECTED_COLLECTIONS,
): Promise<SchemaStatus> {
  try {
    const results = await Promise.all(
      tables.map(async (table) => {
        try {
          const exists = await probe(table);
          return { table, exists };
        } catch (e) {
          if (e instanceof MissingCollectionError) {
            return { table, exists: false };
          }
          throw e;
        }
      }),
    );
    return summarizeSchemaStatus(results);
  } catch {
    return { checked: false, ok: true, missing: [] };
  }
}
