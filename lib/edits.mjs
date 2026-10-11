// The edit cases: how one is generated from a document, and how one is run.
//
// A case is one `Editor` method applied to a freshly opened source:
// `{ id, op, args }`, where `op` is the method name and `args` its
// arguments as JSON. Its expectation is the source the editor holds
// afterwards, `{ ok: true, out }`, or the status it refused with,
// `{ ok: false, status }`. A refusal's message is not compared: messages
// are the implementation's, statuses are the contract's.

/** The `Editor` methods a case may name. Each takes `args` as written. */
export const OPS = new Set([
  "replaceValue", "setValue", "insertValue", "renameKey", "deleteKey",
  "appendValue", "prependValue", "deleteItem", "moveKey", "reorderKeys",
  "moveItem", "reorderItems", "setSequence",
  "addLeadingComment", "setTrailingComment", "deleteLeadingComment", "deleteTrailingComment",
  "addDanglingComment", "deleteDanglingComment",
  "deleteContainer", "renameContainer", "insertContainer",
]);

/** Run `c` over `source` in `format`; the outcome, in the expectation's shape. */
export function run(fig, source, format, c) {
  if (!OPS.has(c.op)) throw new Error(`unknown op ${c.op}`);
  let ed;
  try {
    ed = fig.Editor.open(source, format);
  } catch (e) {
    return refusal(fig, e, "open");
  }
  try {
    ed[c.op](...c.args);
    return { ok: true, out: ed.source() };
  } catch (e) {
    return refusal(fig, e);
  } finally {
    ed.dispose();
  }
}

function refusal(fig, e, at) {
  const names = Object.fromEntries(Object.entries(fig.Status).map(([k, v]) => [v, k]));
  const status = e instanceof fig.FigError ? (names[e.status] ?? `status ${e.status}`) : `threw ${e?.constructor?.name ?? "?"}`;
  return at ? { ok: false, status, at } : { ok: false, status };
}

export function same(a, b) {
  return a.ok === b.ok && (a.ok ? a.out === b.out : a.status === b.status && a.at === b.at);
}

// A case file holds a successful outcome as the splice that makes it from
// the source, `{ ok: true, splice: [start, end, text] }`: the source's
// UTF-8 bytes from `start` to `end` replaced by `text`. The whole document
// for every case would be most of the file.

export function encode(source, outcome) {
  if (!outcome.ok) return outcome;
  const a = Buffer.from(source), b = Buffer.from(outcome.out);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  // Keep the cut on character boundaries, so `text` is whole UTF-8.
  const cont = (x) => (x & 0xc0) === 0x80;
  while (start > 0 && (cont(a[start]) || cont(b[start]))) start--;
  while (end > 0 && (cont(a[a.length - end]) || cont(b[b.length - end]))) end--;
  return { ok: true, splice: [start, a.length - end, b.subarray(start, b.length - end).toString()] };
}

export function decode(source, expect) {
  if (!expect.ok || !expect.splice) return expect;
  const [start, end, text] = expect.splice;
  const a = Buffer.from(source);
  return { ok: true, out: Buffer.concat([a.subarray(0, start), Buffer.from(text), a.subarray(end)]).toString() };
}

// ── invariants ───────────────────────────────────────────────────────────
//
// Parity with the compiled format cannot catch a fault both share. What an
// edit must leave alone can be checked without any reference: a comment
// edit changes no value. A case whose recorded answer breaks that is
// suspect, and the recording says so beside the expectation.

const COMMENT_OPS = new Set([
  "addLeadingComment", "setTrailingComment", "deleteLeadingComment", "deleteTrailingComment",
  "addDanglingComment", "deleteDanglingComment",
]);

/** Why the outcome of `c` over `source` breaks an invariant, or null. */
export function suspect(fig, source, format, c, outcome) {
  if (!outcome.ok || !COMMENT_OPS.has(c.op)) return null;
  const before = tree(fig, source, format);
  const after = tree(fig, outcome.out, format);
  if (after === undefined) return "the edited document does not parse";
  return JSON.stringify(before) === JSON.stringify(after) ? null : "a comment edit changed a value";
}

function tree(fig, source, format) {
  try {
    const doc = fig.Document.parse(source, format);
    try { return shape(fig, doc, doc.root()); } finally { doc.dispose(); }
  } catch {
    return undefined;
  }
}

// ── generation ─────────────────────────────────────────────────────────────
//
// Every case is generated from the document's tree, so a source added to a
// suite brings its cases with it. For each entry: rename, delete, replace
// with a scalar of each kind and with each kind of container, and add or
// remove each kind of comment. For each mapping: insert each kind of value,
// reorder, move a key, and the whole-container edits. For each sequence:
// append, prepend, delete, move and reorder items. Comment removals are
// generated only where the source has a comment to remove.

const SCALARS = [
  ["int", 42],
  ["negative", -7],
  ["float", 2.5],
  ["bool", true],
  ["word", "word"],
  ["spaced", "two words"],
  ["punctuated", "a: b # c, [d] {e} \"f\" 'g'"],
  ["multiline", "line one\nline two"],
  ["empty", ""],
];
const CONTAINERS = [
  ["map", { x: 1, y: "two" }],
  ["list", ["a", "b"]],
  ["nested", { inner: { deep: [1, 2] } }],
  ["empty-map", {}],
  ["empty-list", []],
];
const COMMENT = "added comment";
const MAX_DEPTH = 4;

export function generate(fig, source, format) {
  let tree;
  try {
    const doc = fig.Document.parse(source, format);
    try { tree = shape(fig, doc, doc.root()); } finally { doc.dispose(); }
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  const add = (id, op, ...args) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, op, args });
  };
  const ed = fig.Editor.open(source, format);
  const has = (get, path) => {
    try { return ed[get](path) !== null; } catch { return false; }
  };
  try {
    if (tree.kind === "map" || tree.kind === "seq") walk(tree, [], 0);
    else {
      add("root: set new key", "setValue", ["set_key"], "set");
      add("root: insert map", "insertValue", [], "added_map", CONTAINERS[0][1]);
      for (const [name, v] of SCALARS.slice(0, 5)) add(`root: replace with ${name}`, "replaceValue", [], v);
      add("root: replace with map", "replaceValue", [], CONTAINERS[0][1]);
    }
  } finally {
    ed.dispose();
  }
  return out;

  function at(path) {
    return path.length === 0 ? "root" : path.map((s) => (typeof s === "number" ? `[${s}]` : s)).join(".");
  }

  function entry(path, value, inMap) {
    const p = at(path);
    if (inMap) {
      add(`${p}: rename`, "renameKey", path, "renamed");
      add(`${p}: delete`, "deleteKey", path);
    }
    for (const [name, v] of SCALARS) add(`${p}: replace with ${name}`, "replaceValue", path, v);
    for (const [name, v] of CONTAINERS) add(`${p}: replace with ${name}`, "replaceValue", path, v);
    add(`${p}: add leading comment`, "addLeadingComment", path, COMMENT);
    add(`${p}: set trailing comment`, "setTrailingComment", path, COMMENT);
    if (has("getLeadingComment", path)) add(`${p}: delete leading comment`, "deleteLeadingComment", path);
    if (has("getTrailingComment", path)) add(`${p}: delete trailing comment`, "deleteTrailingComment", path);
    if (inMap && value.kind === "map") {
      add(`${p}: delete container`, "deleteContainer", path);
      add(`${p}: rename container`, "renameContainer", path, "renamed");
    }
  }

  function walk(v, path, depth) {
    if (depth > MAX_DEPTH) return;
    const p = at(path);
    if (v.kind === "map") {
      const keys = v.entries.map(([k]) => k).filter((k) => k !== null);
      for (const [name, x] of SCALARS.slice(0, 5)) add(`${p}: insert ${name}`, "insertValue", path, `added_${name}`, x);
      for (const [name, x] of CONTAINERS) add(`${p}: insert ${name}`, "insertValue", path, `added_${name}`, x);
      add(`${p}: set new key`, "setValue", [...path, "set_key"], "set");
      if (keys.length > 0) add(`${p}: set existing key`, "setValue", [...path, keys[0]], "set");
      if (keys.length >= 2) {
        add(`${p}: reorder keys reversed`, "reorderKeys", path, [...keys].reverse());
        add(`${p}: move last key first`, "moveKey", [...path, keys[keys.length - 1]], [...path, keys[0]]);
      }
      add(`${p}: add dangling comment`, "addDanglingComment", path, COMMENT);
      if (has("getDanglingComment", path)) add(`${p}: delete dangling comment`, "deleteDanglingComment", path);
      for (const key of keys) {
        const child = v.entries.find(([k]) => k === key)[1];
        entry([...path, key], child, true);
        walk(child, [...path, key], depth + 1);
      }
    } else if (v.kind === "seq") {
      const n = v.items.length;
      for (const [name, x] of [SCALARS[0], SCALARS[5], CONTAINERS[0], CONTAINERS[1]]) {
        add(`${p}: append ${name}`, "appendValue", path, x);
        add(`${p}: prepend ${name}`, "prependValue", path, x);
      }
      if (n >= 1) {
        add(`${p}: delete first item`, "deleteItem", path, 0);
        add(`${p}: delete last item`, "deleteItem", path, n - 1);
      }
      if (n >= 2) {
        add(`${p}: move first item last`, "moveItem", path, 0, n - 1);
        add(`${p}: reorder items reversed`, "reorderItems", path, [...Array(n).keys()].reverse());
      }
      if (n >= 1 && v.items.every((x) => x.kind === "scalar")) {
        add(`${p}: set sequence dropping first`, "setSequence", path, v.items.slice(1).map((x) => x.plain).concat(["new"]));
      }
      v.items.forEach((item, i) => {
        entry([...path, i], item, false);
        walk(item, [...path, i], depth + 1);
      });
    }
  }
}

/** The document's tree as generation reads it, from the node API rather
 *  than `toValue`, so that an alias is a node like any other: a mapping's
 *  string keys (null for any other key), a sequence's items, and a
 *  scalar's value as the plain JSON a case can carry (a datetime as its
 *  text). */
function shape(fig, doc, id) {
  const K = fig.NodeKind;
  if (id === null) return { kind: "empty" };
  const children = () => {
    const out = [];
    for (let c = doc.firstChild(id); c !== null; c = doc.nextSibling(c)) out.push(c);
    return out;
  };
  switch (doc.kind(id)) {
    case K.Mapping:
      return {
        kind: "map",
        entries: children().map((kv) => {
          const k = doc.keyOf(kv);
          return [k !== null && doc.kind(k) === K.String ? doc.asString(k) : null, shape(fig, doc, doc.valueOf(kv))];
        }),
      };
    case K.Sequence:
      return { kind: "seq", items: children().map((c) => shape(fig, doc, c)) };
    case K.Null: return { kind: "scalar", plain: null };
    case K.Bool: return { kind: "scalar", plain: doc.asBool(id) };
    case K.Int: case K.Float: {
      const n = Number(doc.asNumberRaw(id));
      return { kind: "scalar", plain: Number.isFinite(n) ? n : doc.asNumberRaw(id) };
    }
    case K.String: return { kind: "scalar", plain: doc.asString(id) };
    case K.Extended: return { kind: "scalar", plain: doc.asExtended(id).text };
    default: return { kind: "other" };
  }
}
