// Converts the Ledger categoriser's plain export (ledger_web_model.json) into the hashed format Fuloos loads.
//
//   node --experimental-strip-types scripts/ledger/hash-model.ts <plain.json> <out.json> [version]
//
// The output keeps only hash buckets, idf values and weights: no merchant strings, no transactions, and none of the
// plain export's own check examples. Do not commit either file to this repository; upload the output to the model
// host and set VITE_LEDGER_MODEL_URL.
import { readFileSync, writeFileSync } from "node:fs";
import {
  hashModel,
  loadModel,
  predictPlain,
  predictProba,
  CHECK_SAMPLES,
  type PlainModel,
} from "../../src/ledger/model.ts";

const [input, output, version = "1"] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: hash-model.ts <plain.json> <out.json> [version]");
  process.exit(1);
}
const plain = JSON.parse(readFileSync(input, "utf8")) as PlainModel & {
  check?: { text: string[]; amount: number[] };
};
const hashed = hashModel(plain, 24, version);
const text = JSON.stringify(hashed);
// Nothing readable from the vocabulary may survive the conversion. The only free text allowed is the self-check,
// which uses the public brand names in CHECK_SAMPLES.
const vocab = new Set([...plain.char.vocab, ...plain.word.vocab]);
const strings: string[] = [];
const walk = (v: unknown, path: string): void => {
  if (typeof v === "string") {
    if (path !== "check.text") strings.push(v);
  } else if (Array.isArray(v)) v.forEach((x) => walk(x, path));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
};
walk(hashed, "");
const leaked = strings.filter((s) => vocab.has(s) && s.trim().length > 1);
if (leaked.length)
  throw new Error(
    `Vocabulary leaked into output: ${leaked.slice(0, 5).join(", ")}`,
  );
const allowedText = new Set(CHECK_SAMPLES.map(([t]) => t));
if (hashed.check.text.some((t) => !allowedText.has(t)))
  throw new Error("Unexpected self-check text.");
const model = loadModel(JSON.parse(text));
const probes: [string, number][] = [
  ...CHECK_SAMPLES,
  ...(plain.check
    ? plain.check.text.map((t, i): [string, number] => [
        t,
        plain.check!.amount[i],
      ])
    : []),
];
let maxDiff = 0;
for (const [t, a] of probes) {
  const p = predictProba(model, t, a),
    q = predictPlain(plain, t, a);
  for (let k = 0; k < p.length; k++)
    maxDiff = Math.max(maxDiff, Math.abs(p[k] - q[k]));
}
writeFileSync(output, text);
console.log(
  `Wrote ${output}: ${(text.length / 1024).toFixed(0)} KB, ${hashed.char.buckets.length + hashed.word.buckets.length} features, ` +
    `${hashed.meta.collisions_dropped} collisions dropped, max probability difference vs plain ${maxDiff.toExponential(2)} on ${probes.length} probes.`,
);
