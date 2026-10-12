// The parse checks: what each kind asks of an implementation, and the
// rules a parsed tree is compared to an expected one by.
//
// A check is a manifest entry (suites/<suite>/parse/suite.json):
//
//   { name, kind, corpus, ext, dialect?, expect?, numbers?, scalars?,
//     to?, with?, refused?, outside? }
//
// and its cases are the files in `corpus` with the extension `ext` (or one
// of several). Every case is read as bytes and handed to fig as bytes, so a
// BOM, a CR or a stray byte reaches the implementation as written.
//
//   parses           the case parses; with `expect`, to the tree in its
//                    sibling `<stem>.json` (a case without one is not
//                    counted). `refused` names cases this check expects
//                    refused instead: fig's answer to an
//                    implementation-defined case.
//   refuses          the case is refused.
//   reprints         it parses, prints in its own dialect, and that parses.
//   converts         it parses, converts to `to`, and that parses as `to`;
//                    with `expect: "json"`, to the value in `<stem>.json`.
//   agrees           it parses alike in this dialect and in `with`.
//   stream           a multi-document stream splits, and each part parses.
//   refuses-stream   a multi-document stream is refused.
//
// The expectations:
//
//   tagged   toml-test's encoding: a scalar is `{"type": T, "value": V}`,
//            compared by value. `numbers` picks how a lexeme's value is read:
//            "toml" (any radix with a prefix, `_`, inf/nan, an i64), "fig"
//            (the same, any size) or "yaml-1.1" (leading-zero octal, base
//            60, `.inf`).
//   plain    plain JSON, as `plutil` or the NestedText reference writes it:
//            a JSON number wants a number of the same kind (integer or
//            real) and value. With `scalars: "strings"`, every scalar wants
//            a string spelled as the JSON is.
//   json     the converted JSON text, compared to `<stem>.json` as values.
//
// Mappings compare without regard to order, with the entry count checked,
// and sequences in order: the rules fig's Zig scoreboards used.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { caseFile } from "./vendor.mjs";

/** A check that cannot be run against this implementation, and why. */
export class NotRunnable extends Error {}

/** Run `check` (from the manifest at `base`) against `fig`; `dialect` is
 *  the suite's. Returns `{ correct, total, outside?, failures }`; throws
 *  `NotRunnable` when the implementation lacks what the check needs. */
export function runCheck(fig, check, base, dialect) {
  if (UNSUPPORTED[check.kind]) throw new NotRunnable(UNSUPPORTED[check.kind]);
  const run = KINDS[check.kind];
  if (!run) throw new Error(`unknown check kind ${check.kind}`);
  const ctx = {
    fig,
    check,
    format: formatOf(fig, check.dialect ?? dialect),
    to: check.to && formatOf(fig, check.to),
    with: check.with && formatOf(fig, check.with),
  };
  const dir = join(base, check.corpus);
  const score = { correct: 0, total: 0, failures: [] };
  const outside = { correct: 0, total: 0 };
  for (const file of readdirSync(dir).filter((f) => caseFile(check, f)).sort()) {
    const stem = file.slice(0, file.lastIndexOf("."));
    const expected = expectation(check, dir, stem);
    if (expected === SKIP) continue;
    let why;
    try {
      why = run(ctx, readFileSync(join(dir, file)), expected, file);
    } catch (e) {
      why = `threw ${message(e)}`;
    }
    // A case outside the contract is tallied apart: what an implementation
    // answers there is the host's doing, not the language's.
    const into = check.outside?.[file] ? outside : score;
    into.total++;
    if (why == null) into.correct++;
    else score.failures.push({ case: file, why: check.outside?.[file] ? `${why} (outside the contract)` : why });
  }
  if (outside.total) score.outside = outside;
  return score;
}

function formatOf(fig, name) {
  const format = fig.formatByName(name);
  if (format == null) throw new NotRunnable(`no dialect named ${JSON.stringify(name)}`);
  return format;
}

const SKIP = Symbol("no expectation");

/** What a case is compared to: its sibling `<stem>.json`, read so that a
 *  number keeps its spelling; `undefined` when the check compares nothing;
 *  `SKIP` when it does but the case has no expectation. */
function expectation(check, dir, stem) {
  if (!check.expect) return undefined;
  const path = join(dir, `${stem}.json`);
  if (!existsSync(path)) return SKIP;
  const text = readFileSync(path, "utf8");
  // yaml-test-suite's `in.json` is empty for a stream of no documents
  // (a comment, a bare `...`); read as one document, that is null.
  if (check.expect === "json") return text.trim() === "" ? null : JSON.parse(text);
  return readJson(text);
}

/** JSON with each number kept as `{ number: <its source text> }`, so an
 *  integer and a real stay apart and a big integer keeps its digits. */
export function readJson(text) {
  return JSON.parse(text, (k, v, ctx) => (typeof v === "number" ? { number: ctx.source } : v));
}

// ── the kinds ────────────────────────────────────────────────────────────
//
// Each returns null for a pass, or why the case failed.

const KINDS = {
  parses(ctx, bytes, expected, file) {
    const wantRefusal = ctx.check.refused?.includes(file);
    const doc = parse(ctx.fig, bytes, ctx.format);
    if (!doc.ok) return wantRefusal ? null : `refused: ${doc.why}`;
    try {
      if (wantRefusal) return "parsed; fig refuses this one";
      if (expected === undefined) return null;
      return compare(ctx.check, readTree(ctx.fig, doc.doc), expected);
    } finally {
      doc.doc.dispose();
    }
  },

  refuses(ctx, bytes) {
    const doc = parse(ctx.fig, bytes, ctx.format);
    if (!doc.ok) return null;
    doc.doc.dispose();
    return "parsed";
  },

  reprints(ctx, bytes) {
    return roundTrip(ctx, bytes, ctx.format, "print");
  },

  converts(ctx, bytes, expected) {
    if (!ctx.to) throw new Error(`check ${ctx.check.name}: converts needs \`to\``);
    return roundTrip(ctx, bytes, ctx.to, "convert", expected);
  },

  agrees(ctx, bytes) {
    const a = parse(ctx.fig, bytes, ctx.format);
    if (!a.ok) return `refused: ${a.why}`;
    const b = parse(ctx.fig, bytes, ctx.with);
    try {
      if (!b.ok) return `${ctx.check.with} refuses it: ${b.why}`;
      const x = readTree(ctx.fig, a.doc), y = readTree(ctx.fig, b.doc);
      return sameTree(x, y) ? null : `${ctx.check.with} reads another tree`;
    } finally {
      a.doc.dispose();
      if (b.ok) b.doc.dispose();
    }
  },

};

// fig's JS API has no stream splitter: the compiled one is core's
// `Embed.extractStream`, which no binding exports, and the language
// contract has no `split` request yet (core only §4.2 proposes one). Until
// one of them exists, these checks score nothing rather than something
// misleading.
const UNSUPPORTED = {
  stream: "fig's API offers no stream splitter",
  "refuses-stream": "fig's API offers no stream splitter",
};

function parse(fig, bytes, format) {
  try {
    return { ok: true, doc: fig.Document.parse(bytes, format) };
  } catch (e) {
    return { ok: false, why: message(e) };
  }
}

/** Parse, write out in `format`, and parse what was written as `format`.
 *  With an expectation, the written JSON must also equal it as values. */
function roundTrip(ctx, bytes, format, verb, expected) {
  const doc = parse(ctx.fig, bytes, ctx.format);
  if (!doc.ok) return `refused: ${doc.why}`;
  let text;
  try {
    text = doc.doc.serialize(format);
  } catch (e) {
    return `${verb}: ${message(e)}`;
  } finally {
    doc.doc.dispose();
  }
  const again = parse(ctx.fig, text, format);
  if (!again.ok) return `${verb}ed text is refused: ${again.why}`;
  again.doc.dispose();
  if (expected === undefined) return null;
  return sameJson(JSON.parse(text), expected, "$");
}

function message(e) {
  return String(e?.message ?? e).split("\n")[0].slice(0, 200);
}

// ── the tree ─────────────────────────────────────────────────────────────

/** The parsed document as plain objects, read node by node through the
 *  `Document` API: a number keeps its lexeme (`raw`), so the comparison
 *  rules below read its value, not a binding's conversion of it. An empty
 *  document is null. */
export function readTree(fig, doc) {
  const { NodeKind: K } = fig;
  const node = (id) => {
    switch (doc.kind(id)) {
      case K.Null: return { kind: "null" };
      case K.Bool: return { kind: "bool", value: doc.asBool(id) };
      case K.Int: return { kind: "int", raw: doc.asNumberRaw(id) };
      case K.Float: return { kind: "float", raw: doc.asNumberRaw(id) };
      case K.String: return { kind: "string", value: doc.asString(id) };
      case K.Extended: return { kind: "ext", ...doc.asExtended(id) };
      case K.Sequence: return { kind: "seq", items: Array.from(doc.children(id), node) };
      case K.Mapping:
        return {
          kind: "map",
          entries: Array.from(doc.children(id), (kv) => {
            const v = doc.valueOf(kv);
            return [node(doc.keyOf(kv)), v == null ? { kind: "null" } : node(v)];
          }),
        };
      default: return { kind: `node kind ${doc.kind(id)}` };
    }
  };
  const root = doc.root();
  return root == null ? { kind: "null" } : node(root);
}

function sameTree(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function show(t) {
  if (t.kind === "ext") return `ext(${t.ext}) ${t.text}`;
  if ("raw" in t) return `${t.kind} ${t.raw}`;
  if ("value" in t) return `${t.kind} ${JSON.stringify(t.value)}`;
  return t.kind;
}

// ── comparing ────────────────────────────────────────────────────────────

function compare(check, tree, expected) {
  if (check.expect === "tagged") return tagged(tree, expected, NUMBERS[check.numbers ?? "toml"], "$");
  if (check.expect === "plain") {
    const leaf = check.scalars === "strings" ? stringLeaf : plainLeaf;
    return plain(tree, expected, leaf, "$");
  }
  throw new Error(`check ${check.name}: unknown expect ${check.expect}`);
}

/** Walk from the expected side, so a key the tree lacks is a mismatch
 *  rather than a comparison skipped, and count entries, so a key the tree
 *  invented is one too. `leaf` answers a scalar, or undefined for a
 *  container. */
function walk(tree, want, leaf, path) {
  const l = leaf(tree, want, path);
  if (l !== undefined) return l;
  if (Array.isArray(want)) {
    if (tree.kind !== "seq") return `${path}: want a sequence, got ${show(tree)}`;
    if (tree.items.length !== want.length) return `${path}: want ${want.length} items, got ${tree.items.length}`;
    for (let i = 0; i < want.length; i++) {
      const m = walk(tree.items[i], want[i], leaf, `${path}[${i}]`);
      if (m) return m;
    }
    return null;
  }
  if (want !== null && typeof want === "object") {
    if (tree.kind !== "map") return `${path}: want a mapping, got ${show(tree)}`;
    const keys = Object.keys(want);
    for (const k of keys) {
      const e = tree.entries.find(([key]) => key.kind === "string" && key.value === k);
      if (!e) return `${path}: no key ${JSON.stringify(k)}`;
      const m = walk(e[1], want[k], leaf, `${path}.${k}`);
      if (m) return m;
    }
    if (tree.entries.length !== keys.length) return `${path}: want ${keys.length} keys, got ${tree.entries.length}`;
    return null;
  }
  return `${path}: the expectation has a bare ${typeof want} here`;
}

// tagged ────────────────────────────────────────────────────────────────

const TAGS = new Set(["null", "string", "integer", "float", "bool", "datetime", "datetime-local", "date-local", "time-local"]);
// The ExtKind each tagged datetime type wants (fig's `ExtKind`).
const DATETIME = { datetime: 0, "datetime-local": 1, "date-local": 2, "time-local": 3 };

/** A tagged leaf is an object of exactly `type` and `value`, both strings,
 *  `type` a known one; a mapping whose values are themselves tagged is a
 *  real mapping that happens to have those keys. */
function asTag(want) {
  if (want === null || typeof want !== "object" || Array.isArray(want)) return null;
  const keys = Object.keys(want);
  if (keys.length !== 2 || typeof want.type !== "string" || typeof want.value !== "string" || !TAGS.has(want.type)) return null;
  return want;
}

function tagged(tree, want, numbers, path) {
  return walk(tree, want, (t, w, p) => {
    if (w !== null && typeof w === "object" && "number" in w) return `${p}: the expectation has a bare number here`;
    const tag = asTag(w);
    if (!tag) return undefined;
    const ok = taggedLeaf(t, tag, numbers);
    return ok ? null : `${p}: want ${tag.type} ${JSON.stringify(tag.value)}, got ${show(t)}`;
  }, path);
}

function taggedLeaf(t, { type, value }, numbers) {
  switch (type) {
    case "null": return t.kind === "null";
    case "string": return t.kind === "string" && t.value === value;
    case "bool": return t.kind === "bool" && String(t.value) === value;
    case "integer": return t.kind === "int" && numbers.int(t.raw, value);
    case "float": {
      // A non-finite number is an extended scalar in some formats (fig's
      // `ExtKind.NumberSpecial`, 6), a float in others; either is a float.
      const raw = t.kind === "float" ? t.raw : t.kind === "ext" && t.ext === 6 ? t.text : null;
      if (raw === null) return false;
      const a = numbers.float(raw), b = numbers.float(value);
      if (a === null || b === null) return false;
      return Number.isNaN(a) ? Number.isNaN(b) : a === b;
    }
    default:
      return t.kind === "ext" && t.ext === DATETIME[type] && numbers.datetime(t.text) === numbers.datetime(value);
  }
}

const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;
const inI64 = (v) => (v >= I64_MIN && v <= I64_MAX ? v : null);
const DIGITS = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9a-fA-F]+$/ };
const PREFIX = { 2: "0b", 8: "0o", 10: "", 16: "0x" };

/** `digits` in `base` as a BigInt, or null if they are not that or (unless
 *  `wide`) the value is outside i64. */
function bigint(digits, base, negative, wide = false) {
  if (!DIGITS[base].test(digits)) return null;
  const v = BigInt(PREFIX[base] + digits);
  return wide ? (negative ? -v : v) : inI64(negative ? -v : v);
}

/** A decimal float as Zig's `parseFloat` reads one (`inf`, `nan` and a
 *  decimal, any case), or null. Stricter than `Number`, which reads "" as 0. */
function decimalFloat(s) {
  if (/^[+-]?inf(inity)?$/i.test(s)) return s[0] === "-" ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(s)) return NaN;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  return null;
}

function splitSign(s) {
  if (s[0] === "+" || s[0] === "-") return [s[0] === "-", s.slice(1)];
  return [false, s];
}

/** toml-test's integer reading: `_` stripped, a `0x`/`0o`/`0b` prefix
 *  after the sign; the expected value is its decimal spelling. TOML's are
 *  i64; fig's are not bounded. */
const radixInt = (wide) => (raw, want) => {
  const [neg, s] = splitSign(raw.replaceAll("_", ""));
  const m = s.match(/^0([xob])(.*)$/i);
  const v = m ? bigint(m[2], { x: 16, o: 8, b: 2 }[m[1].toLowerCase()], neg, wide) : bigint(s, 10, neg, wide);
  return v !== null && String(v) === want;
};

const NUMBERS = {
  toml: {
    int: radixInt(false),
    float(raw) {
      const s = raw.replaceAll("_", "");
      if (s === "inf" || s === "+inf") return Infinity;
      if (s === "-inf") return -Infinity;
      if (s === "nan" || s === "+nan" || s === "-nan") return NaN;
      return decimalFloat(s);
    },
    // Separator to `T`, letters upper-cased, seconds supplied where TOML
    // 1.1 omits them (`13:37` is `13:37:00`), and the fraction cut or
    // padded to toml-test's three digits.
    datetime(s) {
      const start = s.length >= 3 && s[2] === ":" ? 0 : s.length >= 11 ? 11 : -1;
      if (start >= 0 && s.length >= start + 5 && s[start + 5] !== ":") s = s.slice(0, start + 5) + ":00" + s.slice(start + 5);
      let out = "";
      for (let i = 0; i < s.length;) {
        const c = s[i];
        if (i === 10 && c === " ") { out += "T"; i++; }
        else if (c === ".") {
          let frac = "";
          for (i++; i < s.length && s[i] >= "0" && s[i] <= "9"; i++) frac += s[i];
          out += "." + (frac + "000").slice(0, 3);
        } else { out += c.toUpperCase(); i++; }
      }
      return out;
    },
  },
  // TOML's reading, with integers of any size: fig's spec makes a
  // number's lexeme its identity, and sets no bound on it.
  get fig() {
    return { ...NUMBERS.toml, int: radixInt(true) };
  },
  // YAML 1.1's tag repository: leading-zero octal (no `0o`), `0b`, `0x`,
  // base 60 (`1:30`), and `.inf`/`.nan`. Both sides are read the same way.
  "yaml-1.1": {
    int(raw, want) {
      const a = yaml11Int(raw);
      const [neg, s] = splitSign(want);
      const b = bigint(s, 10, neg);
      return a !== null && b !== null && a === b;
    },
    float: yaml11Float,
    // Separator to `T`, letters upper-cased; nothing else.
    datetime(s) {
      let out = "";
      for (let i = 0; i < s.length; i++) out += i === 10 && (s[i] === " " || s[i] === "t") ? "T" : s[i].toUpperCase();
      return out;
    },
  },
};

function yaml11Int(raw) {
  const [neg, s] = splitSign(raw);
  if (!s) return null;
  if (s.includes(":")) {
    let v = 0n;
    for (const group of s.split(":")) {
      const g = group.replaceAll("_", "");
      if (!group || !/^[0-9]*$/.test(g)) return null;
      v = v * 60n + BigInt(g || "0");
    }
    return inI64(neg ? -v : v);
  }
  let base = 10, digits = s;
  if (/^0[xX]/.test(s)) { base = 16; digits = s.slice(2); }
  else if (/^0[bB]/.test(s)) { base = 2; digits = s.slice(2); }
  else if (s.length >= 2 && s[0] === "0") { base = 8; digits = s.slice(1); }
  digits = digits.replaceAll("_", "");
  if (!digits) return base === 8 ? 0n : null;
  return bigint(digits, base, neg);
}

function yaml11Float(raw) {
  const [neg, s] = splitSign(raw);
  if (!s) return null;
  if (/^\.?inf$/i.test(s)) return neg ? -Infinity : Infinity;
  if (/^\.?nan$/i.test(s)) return NaN;
  let v;
  if (s.includes(":")) {
    v = 0;
    for (const group of s.split(":")) {
      const g = decimalFloat(group.replaceAll("_", ""));
      if (g === null || group === "") return null;
      v = v * 60 + g;
    }
  } else {
    v = decimalFloat(s.replaceAll("_", ""));
    if (v === null) return null;
  }
  return neg ? -v : v;
}

// plain ─────────────────────────────────────────────────────────────────

function plain(tree, want, leaf, path) {
  return walk(tree, want, leaf, path);
}

/** A plain JSON scalar against a typed tree: `plutil`'s oracles. */
function plainLeaf(t, w, p) {
  if (w === null) return t.kind === "null" ? null : `${p}: want null, got ${show(t)}`;
  if (typeof w === "string") {
    // A `<date>` or `<data>` is an extended scalar; were an oracle ever to
    // spell one as a string, its text is what it would say.
    const ok = (t.kind === "string" && t.value === w) || (t.kind === "ext" && t.text === w);
    return ok ? null : `${p}: want string ${JSON.stringify(w)}, got ${show(t)}`;
  }
  if (typeof w === "boolean") return t.kind === "bool" && t.value === w ? null : `${p}: want ${w}, got ${show(t)}`;
  if ("number" in w) {
    const real = /[.eE]/.test(w.number);
    const ok = real
      ? t.kind === "float" && decimalFloat(t.raw) !== null && decimalFloat(t.raw) === decimalFloat(w.number)
      : t.kind === "int" && decimalInt(t.raw) !== null && decimalInt(t.raw) === decimalInt(w.number);
    return ok ? null : `${p}: want ${real ? "real" : "integer"} ${w.number}, got ${show(t)}`;
  }
  return undefined;
}

function decimalInt(s) {
  const [neg, d] = splitSign(s);
  return bigint(d, 10, neg);
}

/** Every scalar a string: NestedText's, whose reference implementation
 *  reads nothing else. */
function stringLeaf(t, w, p) {
  if (w === null) return t.kind === "null" ? null : `${p}: want null, got ${show(t)}`;
  let s;
  if (typeof w === "string") s = w;
  else if (typeof w === "boolean") s = String(w);
  else if ("number" in w) s = w.number;
  else return undefined;
  return t.kind === "string" && t.value === s ? null : `${p}: want string ${JSON.stringify(s)}, got ${show(t)}`;
}

// json ──────────────────────────────────────────────────────────────────

/** Two JSON values alike: numbers equal as numbers, objects with the same
 *  keys in any order, arrays in order. */
function sameJson(a, b, path) {
  if (Array.isArray(b)) {
    if (!Array.isArray(a)) return `${path}: want an array, got ${JSON.stringify(a)?.slice(0, 60)}`;
    if (a.length !== b.length) return `${path}: want ${b.length} items, got ${a.length}`;
    for (let i = 0; i < b.length; i++) {
      const m = sameJson(a[i], b[i], `${path}[${i}]`);
      if (m) return m;
    }
    return null;
  }
  if (b !== null && typeof b === "object") {
    if (a === null || typeof a !== "object" || Array.isArray(a)) return `${path}: want an object, got ${JSON.stringify(a)?.slice(0, 60)}`;
    const keys = Object.keys(b);
    if (Object.keys(a).length !== keys.length) return `${path}: want ${keys.length} keys, got ${Object.keys(a).length}`;
    for (const k of keys) {
      if (!Object.hasOwn(a, k)) return `${path}: no key ${JSON.stringify(k)}`;
      const m = sameJson(a[k], b[k], `${path}.${k}`);
      if (m) return m;
    }
    return null;
  }
  return a === b ? null : `${path}: want ${JSON.stringify(b)}, got ${JSON.stringify(a)}`;
}
