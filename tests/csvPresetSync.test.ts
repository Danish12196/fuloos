import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
import {
  buildPreset,
  createAccountPresetStore,
  createLocalPresetStore,
  loadPresets,
  presetFromRecord,
  presetToRecord,
  PRESET_STORAGE_KEY,
  type CsvPreset,
  type PresetRecord,
  type PresetRecordBody,
  type PresetRemote,
  type PresetStorage,
} from "../src/csvPresets.ts";

function createMockStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(
    initial ? Object.entries(initial) : undefined,
  );
  const storage: PresetStorage & { map: Map<string, string> } = {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return storage;
}

function createMockRemote(initial: PresetRecord[] = []) {
  const records = new Map(initial.map((r) => [r.id, r]));
  const calls: string[] = [];
  let next = 1;
  let failNames = new Set<string>();
  let listError: Error | null = null;
  const remote: PresetRemote = {
    async list() {
      calls.push("list");
      if (listError) throw listError;
      return [...records.values()];
    },
    async save(body: PresetRecordBody, id?: string) {
      calls.push(id ? `update:${id}:${body.name}` : `create:${body.name}`);
      if (failNames.has(body.name)) throw new Error("Server rejected preset.");
      for (const r of records.values()) {
        if (
          r.id !== id &&
          (r as PresetRecord & { name_key?: string }).name_key === body.name_key
        )
          throw new Error("A preset with this name already exists.");
      }
      const record = {
        id: id ?? `rec${next++}`,
        name: body.name,
        name_key: body.name_key,
        config: JSON.parse(JSON.stringify(body.config)),
      };
      records.set(record.id, record);
      return record;
    },
    async remove(id: string) {
      calls.push(`remove:${id}`);
      records.delete(id);
    },
  };
  return {
    remote,
    records,
    calls,
    failOn: (names: string[]) => {
      failNames = new Set(names);
    },
    failList: (e: Error | null) => {
      listError = e;
    },
  };
}

function preset(name: string, firstRow = ["Date", "Payee", "Amount"]) {
  return buildPreset({
    name,
    delimiter: ",",
    header: true,
    skip: 0,
    firstRow,
    options: {
      date: 0,
      payee: 1,
      amount: 2,
      notes: -1,
      category: -1,
      debit: -1,
      credit: -1,
      split: false,
      flip: false,
      decimal: ".",
      dateFormat: "DMY",
    },
  });
}

function localBlob(presets: CsvPreset[]) {
  return {
    [PRESET_STORAGE_KEY]: JSON.stringify({ version: 1, presets }),
  };
}

function record(id: string, p: CsvPreset): PresetRecord {
  return { id, ...presetToRecord(p) };
}

test("preset records round-trip through the server shape", () => {
  const p = preset("  Emirates NBD ");
  const body = presetToRecord(p);
  assert.equal(body.name, "Emirates NBD");
  assert.equal(body.name_key, "emirates nbd");
  assert.equal("name" in body.config, false);
  assert.deepEqual(presetFromRecord({ id: "x", ...body }), {
    ...p,
    name: "Emirates NBD",
  });
  assert.equal(presetFromRecord({ id: "x", name: "Bad", config: null }), null);
  assert.equal(
    presetFromRecord({
      id: "x",
      name: "Bad",
      config: { ...body.config, delimiter: "x" },
    }),
    null,
  );
});

test("first account load uploads browser presets, keeps account copies on name clashes, and clears the browser", async () => {
  const storage = createMockStorage(
    localBlob([preset("ADCB"), preset("Mashreq"), preset("emirates nbd")]),
  );
  const accountCopy = preset("Emirates NBD", ["Date", "Description", "Amount"]);
  const m = createMockRemote([record("existing", accountCopy)]);
  const store = createAccountPresetStore(m.remote, storage);

  const result = await store.load();
  assert.equal(store.scope(), "account");
  assert.deepEqual(
    result.presets.map((p) => p.name),
    ["ADCB", "Emirates NBD", "Mashreq"],
  );
  assert.deepEqual(
    result.presets.find((p) => p.name === "Emirates NBD")?.headers,
    ["Date", "Description", "Amount"],
  );
  assert.match(result.notice ?? "", /Moved 2 presets/);
  assert.match(result.notice ?? "", /1 browser preset matched/);
  assert.equal(m.records.size, 3);
  assert.equal(storage.map.has(PRESET_STORAGE_KEY), false);

  // A second load (e.g. another dialog open) does not re-upload anything.
  m.calls.length = 0;
  const again = await store.load();
  assert.equal(again.notice, undefined);
  assert.deepEqual(m.calls, ["list"]);
});

test("failed uploads stay in the browser and are retried on the next load", async () => {
  const storage = createMockStorage(localBlob([preset("ADCB"), preset("FAB")]));
  const m = createMockRemote();
  m.failOn(["FAB"]);
  const store = createAccountPresetStore(m.remote, storage);

  const first = await store.load();
  assert.deepEqual(
    first.presets.map((p) => p.name),
    ["ADCB"],
  );
  assert.match(first.notice ?? "", /1 preset could not be uploaded/);
  assert.deepEqual(
    loadPresets(storage).map((p) => p.name),
    ["FAB"],
  );

  m.failOn([]);
  const second = await store.load();
  assert.deepEqual(
    second.presets.map((p) => p.name),
    ["ADCB", "FAB"],
  );
  assert.equal(storage.map.has(PRESET_STORAGE_KEY), false);
});

test("account store saves, replaces, renames and deletes through the server", async () => {
  const storage = createMockStorage();
  const m = createMockRemote();
  const store = createAccountPresetStore(m.remote, storage);
  await store.load();

  const created = await store.save(preset("ADCB"));
  assert.equal(created.replaced, false);
  const id = [...m.records.keys()][0];

  const replaced = await store.save(
    preset("adcb", ["Date", "Narrative", "Amount"]),
  );
  assert.equal(replaced.replaced, true);
  assert.equal(m.records.size, 1);
  assert.ok(m.calls.includes(`update:${id}:adcb`));
  assert.deepEqual(replaced.presets[0].headers, [
    "Date",
    "Narrative",
    "Amount",
  ]);

  await store.save(preset("FAB"));
  await assert.rejects(store.rename("adcb", "fab"), /already exists/);
  const renamed = await store.rename("adcb", "  ADCB Current ");
  assert.deepEqual(
    renamed.map((p) => p.name),
    ["ADCB Current", "FAB"],
  );
  assert.equal(m.records.get(id)?.name, "ADCB Current");
  await assert.rejects(store.rename("missing", "Other"), /not found/);

  const remaining = await store.remove("ADCB Current");
  assert.deepEqual(
    remaining.map((p) => p.name),
    ["FAB"],
  );
  assert.equal(m.records.has(id), false);
  assert.equal(storage.map.size, 0, "browser storage is never written");
});

test("account store falls back to browser storage until the server migration exists", async () => {
  const storage = createMockStorage(localBlob([preset("ADCB")]));
  const m = createMockRemote();
  m.failList(
    new Error(
      "Fuloos backend is not configured yet. Install the PocketBase migration before using live accounts.",
    ),
  );
  const store = createAccountPresetStore(m.remote, storage);
  const result = await store.load();
  assert.equal(store.scope(), "browser");
  assert.match(result.notice ?? "", /this browser only/);
  assert.deepEqual(
    result.presets.map((p) => p.name),
    ["ADCB"],
  );
  await store.save(preset("FAB"));
  assert.deepEqual(
    loadPresets(storage).map((p) => p.name),
    ["ADCB", "FAB"],
  );
  assert.deepEqual(m.calls, ["list"]);

  // Other errors are surfaced rather than silently using the browser copy.
  m.failList(new Error("Could not reach PocketBase."));
  await assert.rejects(store.load(), /Could not reach/);
  assert.deepEqual(
    loadPresets(storage).map((p) => p.name),
    ["ADCB", "FAB"],
  );
});

test("local store reports storage write failures as errors", async () => {
  const storage = createMockStorage();
  storage.setItem = () => {
    throw new Error("QuotaExceeded");
  };
  const store = createLocalPresetStore(storage);
  assert.equal(store.scope(), "browser");
  await assert.rejects(store.save(preset("ADCB")), /browser storage/);
});

test("CSV preset migration scopes presets to their owner and enforces unique names per user", async () => {
  const db = new DatabaseSync(":memory:");
  const collections: Record<string, unknown>[] = [];
  db.exec(
    `CREATE TABLE fuloos_csv_presets(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,name_key TEXT,config JSON);`,
  );
  const app = {
    findCollectionByNameOrId: (name: string) => ({ id: `${name}_id` }),
    save: (c: Record<string, unknown>) => collections.push(c),
    db: () => ({
      newQuery: (sql: string) => ({
        execute: () => {
          if (sql.startsWith("CREATE UNIQUE INDEX")) return;
          db.exec(sql);
        },
      }),
    }),
  };
  runInNewContext(
    await readFile(
      new URL(
        "../pocketbase/pb_migrations/1794054600_csv_presets.js",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      migrate: (up: (app: unknown) => void) => up(app),
      Collection: function (value: Record<string, unknown>) {
        return value;
      },
    },
  );
  assert.equal(collections.length, 1);
  const c = collections[0];
  assert.equal(c.name, "fuloos_csv_presets");
  assert.match(String(c.listRule), /user_id = @request.auth.id/);
  assert.match(
    String(c.createRule),
    /@request.body.user_id = @request.auth.id/,
  );
  assert.match(String(c.updateRule), /@request.body.user_id:isset = false/);
  assert.match(String(c.deleteRule), /user_id = @request.auth.id/);
  assert.match(
    String((c.indexes as string[])[0]),
    /UNIQUE INDEX .* \(user_id, name_key\)/,
  );

  const insert = (id: string, user: string, name: string, config = "{}") =>
    db
      .prepare("INSERT INTO fuloos_csv_presets VALUES(?,?,?,?,?)")
      .run(id, user, name, name.trim().toLowerCase(), config);

  insert("p1", "user-a", "ADCB");
  insert("p2", "user-b", "ADCB");
  assert.throws(() => insert("p3", "user-a", "adcb"), /already exists/);
  assert.throws(() => insert("p4", "user-a", "   "), /1-80 characters/);
  assert.throws(() => insert("p5", "user-a", "x".repeat(81)), /1-80/);
  assert.throws(() => insert("p6", "user-a", "FAB", "[]"), /JSON object/);
  assert.throws(() => insert("p7", "user-a", "FAB", "nope"), /JSON object/);
  insert("p8", "user-a", "FAB");
  assert.throws(
    () =>
      db.exec("UPDATE fuloos_csv_presets SET user_id='user-b' WHERE id='p8'"),
    /ownership cannot be changed/,
  );
  db.exec(
    "UPDATE fuloos_csv_presets SET name='ADCB Main', name_key='adcb main' WHERE id='p1'",
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM fuloos_csv_presets").get()?.n,
    3,
  );
});
