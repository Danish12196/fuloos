/* Ledger expense categoriser (MAAI902): TF-IDF (character 2-5 and word 1-2 grams, sublinear tf, l2) + log amount
   -> logistic regression -> per-class sigmoid calibration. Ported from ledger-uae-banks/site/try/sms.js.

   Fuloos only loads the *hashed* export of the model. Every n-gram is replaced by a 24-bit FNV-1a bucket number, so
   the file contains no readable merchant text from the private training SMS. The model file is never committed to
   this repository: it is fetched at runtime from VITE_LEDGER_MODEL_URL (see README, "SMS import"). */

export const HASHED_FORMAT = "ledger-hashed-v1";

/** The plain export from ledger-uae-banks/export_web_model.ipynb (input to hashModel only). */
export interface PlainModel {
  categories: string[];
  classes: string[];
  char: {
    analyzer: string;
    ngram: [number, number];
    vocab: string[];
    idf: number[];
  };
  word: {
    analyzer: string;
    ngram: [number, number];
    vocab: string[];
    idf: number[];
  };
  amount: { mean: number; scale: number };
  coef: number[][];
  intercept: number[];
  calibration?: { method: string; a: number[]; b: number[] } | null;
  review_threshold: number;
  meta?: Record<string, unknown>;
}

interface HashedBlock {
  ngram: [number, number];
  buckets: number[];
  idf: number[];
}
export interface HashedModel {
  format: typeof HASHED_FORMAT;
  hash: { name: "fnv1a32"; bits: number };
  categories: string[];
  classes: string[];
  char: HashedBlock;
  word: HashedBlock;
  amount: { mean: number; scale: number };
  coef: number[][];
  intercept: number[];
  calibration: { a: number[]; b: number[] } | null;
  review_threshold: number;
  check: { text: string[]; amount: number[]; proba: number[][] };
  meta: {
    version: string;
    created: string;
    n_train?: number;
    people?: number;
    min_users?: number;
    collisions_dropped: number;
  };
}

export interface LoadedModel extends HashedModel {
  charIndex: Map<number, number>;
  wordIndex: Map<number, number>;
  nFeat: number;
  order: number[];
}

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const bucket = (prefix: "c" | "w", gram: string, bits: number) =>
  fnv1a(prefix + "\u0001" + gram) & ((1 << bits) - 1);

export function charWbGrams(doc: string, lo: number, hi: number): string[] {
  const out: string[] = [];
  for (const w0 of doc
    .toLowerCase()
    .replace(/\s\s+/g, " ")
    .split(/\s+/)
    .filter(Boolean)) {
    const w = " " + w0 + " ",
      L = w.length;
    for (let n = lo; n <= hi; n++) {
      let off = 0;
      out.push(w.slice(off, off + n));
      while (off + n < L) {
        off++;
        out.push(w.slice(off, off + n));
      }
      if (off === 0) break;
    }
  }
  return out;
}
export function wordGrams(doc: string, lo: number, hi: number): string[] {
  const toks = doc.toLowerCase().match(/\b\w\w+\b/g) || [];
  const out: string[] = [];
  for (let n = lo; n <= hi; n++)
    for (let i = 0; i + n <= toks.length; i++)
      out.push(toks.slice(i, i + n).join(" "));
  return out;
}

function tfidf(
  indices: (number | undefined)[],
  idf: number[],
): [number, number][] {
  const counts = new Map<number, number>();
  for (const j of indices)
    if (j !== undefined) counts.set(j, (counts.get(j) || 0) + 1);
  let norm = 0;
  const feats: [number, number][] = [];
  for (const [j, c] of counts) {
    const v = (1 + Math.log(c)) * idf[j];
    feats.push([j, v]);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  return feats.map(([j, v]) => [j, v / norm]);
}

function scores(
  z: number[],
  calibration: { a: number[]; b: number[] } | null | undefined,
): number[] {
  const K = z.length;
  if (calibration) {
    const p = z.map(
      (f, k) => 1 / (1 + Math.exp(calibration.a[k] * f + calibration.b[k])),
    );
    const s = p.reduce((a, b) => a + b, 0);
    return s > 0 ? p.map((v) => v / s) : p.map(() => 1 / K);
  }
  const mx = Math.max(...z);
  const e = z.map((v) => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
const amountFeature = (amountAed: number, a: { mean: number; scale: number }) =>
  (Math.log1p(Math.max(0, Number.isFinite(amountAed) ? amountAed : 0)) -
    a.mean) /
  a.scale;

/** Probabilities in M.categories order. */
export function predictProba(
  M: LoadedModel,
  text: string,
  amountAed: number,
): number[] {
  const bits = M.hash.bits;
  const xc = tfidf(
    charWbGrams(text, M.char.ngram[0], M.char.ngram[1]).map((g) =>
      M.charIndex.get(bucket("c", g, bits)),
    ),
    M.char.idf,
  );
  const xw = tfidf(
    wordGrams(text, M.word.ngram[0], M.word.ngram[1]).map((g) =>
      M.wordIndex.get(bucket("w", g, bits)),
    ),
    M.word.idf,
  );
  const off = M.char.buckets.length;
  const amt = amountFeature(amountAed, M.amount);
  const z = M.coef.map((W, k) => {
    let s = M.intercept[k] + W[M.nFeat - 1] * amt;
    for (const [j, v] of xc) s += W[j] * v;
    for (const [j, v] of xw) s += W[off + j] * v;
    return s;
  });
  const p = scores(z, M.calibration);
  return M.order.map((i) => p[i]);
}

/** Same maths on the plain export; used only by the converter to verify the hashed copy. */
export function predictPlain(
  P: PlainModel,
  text: string,
  amountAed: number,
): number[] {
  const ci = new Map(P.char.vocab.map((t, i) => [t, i]));
  const wi = new Map(P.word.vocab.map((t, i) => [t, i]));
  const xc = tfidf(
    charWbGrams(text, P.char.ngram[0], P.char.ngram[1]).map((g) => ci.get(g)),
    P.char.idf,
  );
  const xw = tfidf(
    wordGrams(text, P.word.ngram[0], P.word.ngram[1]).map((g) => wi.get(g)),
    P.word.idf,
  );
  const off = P.char.vocab.length,
    nFeat = off + P.word.vocab.length + 1;
  const amt = amountFeature(amountAed, P.amount);
  const z = P.coef.map((W, k) => {
    let s = P.intercept[k] + W[nFeat - 1] * amt;
    for (const [j, v] of xc) s += W[j] * v;
    for (const [j, v] of xw) s += W[off + j] * v;
    return s;
  });
  const p = scores(z, P.calibration);
  return P.categories.map((c) => p[P.classes.indexOf(c)]);
}

/** Public brand names only: used to build the hashed model's self-check. */
export const CHECK_SAMPLES: [string, number][] = [
  ["TALABAT", 45],
  ["CARREFOUR", 210],
  ["ADNOC", 120],
  ["NETFLIX COM", 56],
  ["DEWA", 450],
  ["IKEA", 900],
  ["FLYDUBAI", 1200],
  ["VOX CINEMAS", 90],
  ["ASTER PHARMACY", 75],
  ["DUBAI POLICE FINES", 300],
];

const round = (v: number) => Number(v.toPrecision(7));

/** Replace every n-gram string with its hash bucket. Bucket collisions keep the stronger feature. */
export function hashModel(
  P: PlainModel,
  bits = 24,
  version = "1",
): HashedModel {
  if (
    P.coef.some(
      (row) => row.length !== P.char.vocab.length + P.word.vocab.length + 1,
    )
  )
    throw new Error("Unexpected coefficient width.");
  let collisions = 0;
  const strength = (j: number) =>
    P.coef.reduce((s, row) => s + Math.abs(row[j]), 0);
  const block = (prefix: "c" | "w", vocab: string[], offset: number) => {
    const best = new Map<number, number>();
    vocab.forEach((g, i) => {
      const b = bucket(prefix, g, bits);
      const prev = best.get(b);
      if (prev === undefined) best.set(b, i);
      else {
        collisions++;
        if (strength(offset + i) > strength(offset + prev)) best.set(b, i);
      }
    });
    return [...best.entries()].sort((a, b) => a[0] - b[0]);
  };
  const chars = block("c", P.char.vocab, 0);
  const words = block("w", P.word.vocab, P.char.vocab.length);
  const cols = [
    ...chars.map(([, i]) => i),
    ...words.map(([, i]) => P.char.vocab.length + i),
    P.char.vocab.length + P.word.vocab.length,
  ];
  const meta = P.meta ?? {};
  const H: HashedModel = {
    format: HASHED_FORMAT,
    hash: { name: "fnv1a32", bits },
    categories: P.categories,
    classes: P.classes,
    char: {
      ngram: P.char.ngram,
      buckets: chars.map(([b]) => b),
      idf: chars.map(([, i]) => round(P.char.idf[i])),
    },
    word: {
      ngram: P.word.ngram,
      buckets: words.map(([b]) => b),
      idf: words.map(([, i]) => round(P.word.idf[i])),
    },
    amount: P.amount,
    coef: P.coef.map((row) => cols.map((j) => round(row[j]))),
    intercept: P.intercept.map(round),
    calibration: P.calibration
      ? { a: P.calibration.a.map(round), b: P.calibration.b.map(round) }
      : null,
    review_threshold: P.review_threshold,
    check: { text: [], amount: [], proba: [] },
    meta: {
      version,
      created: new Date().toISOString().slice(0, 10),
      n_train: typeof meta.n_train === "number" ? meta.n_train : undefined,
      people: typeof meta.people === "number" ? meta.people : undefined,
      min_users:
        typeof meta.min_users === "number" ? meta.min_users : undefined,
      collisions_dropped: collisions,
    },
  };
  const M = prepare(H);
  H.check = {
    text: CHECK_SAMPLES.map(([t]) => t),
    amount: CHECK_SAMPLES.map(([, a]) => a),
    proba: CHECK_SAMPLES.map(([t, a]) =>
      predictProba(M, t, a).map((v) => Number(v.toFixed(8))),
    ),
  };
  return H;
}

function prepare(H: HashedModel): LoadedModel {
  return {
    ...H,
    charIndex: new Map(H.char.buckets.map((b, i) => [b, i])),
    wordIndex: new Map(H.word.buckets.map((b, i) => [b, i])),
    nFeat: H.char.buckets.length + H.word.buckets.length + 1,
    order: H.categories.map((c) => H.classes.indexOf(c)),
  };
}

/** Validate a downloaded hashed model and run its self-check. Plain (readable) exports are refused. */
export function loadModel(json: unknown): LoadedModel {
  const H = json as HashedModel;
  if (!H || typeof H !== "object" || H.format !== HASHED_FORMAT)
    throw new Error(
      "Not a hashed Ledger model. Convert it with scripts/ledger/hash-model.ts; plain exports are not accepted.",
    );
  if (H.hash?.name !== "fnv1a32" || !(H.hash.bits > 8 && H.hash.bits <= 30))
    throw new Error("Unsupported model hash.");
  const K = H.classes?.length;
  if (
    !K ||
    H.categories.length !== K ||
    H.coef.length !== K ||
    H.intercept.length !== K
  )
    throw new Error("Model classes are inconsistent.");
  const M = prepare(H);
  if (M.order.some((i) => i < 0))
    throw new Error("Model categories are inconsistent.");
  if (M.coef.some((row) => row.length !== M.nFeat))
    throw new Error("Model coefficients are inconsistent.");
  if (
    M.char.idf.length !== M.char.buckets.length ||
    M.word.idf.length !== M.word.buckets.length
  )
    throw new Error("Model vocabulary is inconsistent.");
  if (
    !H.amount ||
    !Number.isFinite(H.amount.mean) ||
    !Number.isFinite(H.amount.scale) ||
    H.amount.scale === 0
  )
    throw new Error("Model amount scaling is inconsistent.");
  if (
    H.calibration &&
    (H.calibration.a?.length !== K || H.calibration.b?.length !== K)
  )
    throw new Error("Model calibration is inconsistent.");
  if (
    !H.check?.text?.length ||
    H.check.amount?.length !== H.check.text.length ||
    H.check.proba?.length !== H.check.text.length
  )
    throw new Error("Model self-check is missing or inconsistent.");
  H.check.text.forEach((t, i) => {
    const p = predictProba(M, t, H.check.amount[i]);
    if (p.some((v, k) => Math.abs(v - H.check.proba[i][k]) > 1e-4))
      throw new Error(
        "Model self-check failed: the file is damaged or from an incompatible version.",
      );
  });
  return M;
}
