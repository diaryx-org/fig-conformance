// Whether an edit did what it was asked, read back through the
// implementation's own parser: the edit suites' second score, which a
// tool that writes in a style of its own can pass where it cannot match
// the reference's bytes.
//
// An outcome is faithful when
//
//   - it and the recorded answer are both refusals, whatever their status;
//   - or it succeeded, and the edited document parses to the source's tree
//     with exactly the asked-for change made: the value replaced, the entry
//     gone, the key renamed, the items in their new order, and nothing else
//     moved. Key order counts only for a key move or reorder, and a new
//     key may land anywhere in its mapping. A comment edit
//     changes no value, and must change the text unless the reference's
//     answer leaves it as it was.
//
// A value is compared as a document of the format can hold it, as the
// suite's entry in languages.json says: with `"scalars": "strings"`
// (dotenv, INI, .properties, NestedText) `42` is the string "42" and an
// empty container may be written as the empty string; with
// `"empty": "either"` `{}` and `[]` are one another (ZON's `.{}`). A
// container a delete leaves empty may read back as empty, as null, or not
// at all, where the format writes a container only through its keys (a
// TOML dotted key, a YAML `a:` with nothing under it).
//
// Where an edit's path is ambiguous it cannot be judged by the tree, and
// the outcome is faithful only if it is exact: a source with a duplicated
// key, whose path names more than one entry.
//
// What this cannot see is anything outside the tree: a comment lost, a
// comment moved to another value, formatting. Those the exact score sees.

const COMMENT_OPS = new Set([
  "addLeadingComment", "setTrailingComment", "deleteLeadingComment", "deleteTrailingComment",
  "addDanglingComment", "deleteDanglingComment",
]);

/** Why `got`, the outcome of case `c` over `source`, is not faithful, or
 *  null when it is. `expect` is the recorded outcome; `lang` the suite's
 *  entry in languages.json. */
export async function unfaithful(impl, lang, source, c, got, expect) {
  const dialect = lang.dialect;
  if (!got.ok) return expect.ok ? `refused (${got.status}) where the reference edits` : null;
  if (typeof impl.parse !== "function") return "no parse to read the edit back with";
  const enc = new TextEncoder();
  const before = await impl.parse(dialect, enc.encode(source));
  if (!before.ok) return `the source does not parse: ${before.why}`;
  const after = await impl.parse(dialect, enc.encode(got.out));
  if (!after.ok) return `the edited document does not parse: ${after.why}`;
  if (COMMENT_OPS.has(c.op)) {
    if (!sameTree(before.tree, after.tree)) return "a comment edit changed a value";
    if (got.out === source && !(expect.ok && expect.out === source)) return "a comment edit changed nothing";
    return null;
  }
  if (duplicated(before.tree)) {
    return same(got, expect) ? null : "a source with a duplicated key is judged by the exact answer, and this is not it";
  }
  let want;
  try {
    want = apply(before.tree, c);
  } catch (e) {
    return `the edit cannot be made on the source's tree: ${e.message}`;
  }
  return match(after.tree, want, "$", {
    strings: lang.scalars === "strings", either: lang.empty === "either", ordered: c.op === "moveKey" || c.op === "reorderKeys",
  });
}

const same = (a, b) => a.ok === b.ok && (a.ok ? a.out === b.out : a.status === b.status);

function duplicated(t) {
  if (t.kind === "seq") return t.items.some(duplicated);
  if (t.kind !== "map") return false;
  const keys = t.entries.map(([k]) => JSON.stringify(k));
  return new Set(keys).size !== keys.length || t.entries.some(([, v]) => duplicated(v));
}

// ── the asked-for tree ───────────────────────────────────────────────────
//
// The source's tree with the edit made, in which a value the case supplies
// stays the JSON it was given, `{ want: v }`, and an entry the edit adds
// is marked `added`.

const clone = (t) => JSON.parse(JSON.stringify(t));
const isKey = (k, name) => k.kind === "string" && k.value === name;

function node(tree, path) {
  let t = tree;
  for (const seg of path) {
    if (typeof seg === "number") {
      if (t.kind !== "seq" || seg < 0 || seg >= t.items.length) throw new Error(`no item ${seg}`);
      t = t.items[seg];
    } else {
      const e = t.kind === "map" && t.entries.find(([k]) => isKey(k, seg));
      if (!e) throw new Error(`no key ${JSON.stringify(seg)}`);
      t = e[1];
    }
  }
  return t;
}

const map = (tree, path) => {
  const t = node(tree, path);
  // An empty document is an empty mapping to insert into.
  if (path.length === 0 && t.kind === "null") return Object.assign(t, { kind: "map", entries: [] });
  if (t.kind !== "map") throw new Error("not a mapping");
  return t;
};
const seq = (tree, path) => {
  const t = node(tree, path);
  if (t.kind !== "seq") throw new Error("not a sequence");
  return t;
};
const entryIndex = (m, name) => {
  const i = m.entries.findIndex(([k]) => isKey(k, name));
  if (i < 0) throw new Error(`no key ${JSON.stringify(name)}`);
  return i;
};
const strKey = (name) => ({ kind: "string", value: name });

/** Mark every container on `path` that the delete just made empty, and
 *  every one above it holding nothing else, as one that may vanish. */
function emptied(t, path) {
  const chain = [t];
  for (let i = 0; i < path.length; i++) chain.push(node(t, path.slice(0, i + 1)));
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    const kids = n.kind === "map" ? n.entries.map((e) => e[1]) : n.kind === "seq" ? n.items : null;
    if (!kids || !kids.every((k) => k.emptied)) break;
    n.emptied = true;
  }
}

function apply(source, c) {
  const t = clone(source);
  const [path, ...a] = c.args;
  const parent = path.slice(0, -1), last = path[path.length - 1];
  switch (c.op) {
    case "replaceValue":
      if (path.length === 0) return { want: a[0] };
      if (typeof last === "number") seq(t, parent).items[last] = { want: a[0] };
      else { const m = map(t, parent); m.entries[entryIndex(m, last)][1] = { want: a[0] }; }
      return t;
    case "setValue": {
      if (typeof last === "number") { seq(t, parent).items[last] = { want: a[0] }; return t; }
      const m = map(t, parent);
      const i = m.entries.findIndex(([k]) => isKey(k, last));
      if (i >= 0) m.entries[i][1] = { want: a[0] };
      else m.entries.push(Object.assign([strKey(last), { want: a[0] }], { added: true }));
      return t;
    }
    case "insertValue":
      map(t, path).entries.push(Object.assign([strKey(a[0]), { want: a[1] }], { added: true }));
      return t;
    case "deleteKey": case "deleteContainer": {
      const m = map(t, parent);
      m.entries.splice(entryIndex(m, last), 1);
      emptied(t, parent);
      return t;
    }
    case "renameKey": case "renameContainer": {
      const m = map(t, parent);
      m.entries[entryIndex(m, last)][0] = strKey(a[0]);
      return t;
    }
    case "moveKey": {
      const [dest] = a;
      const m = map(t, parent);
      const [e] = m.entries.splice(entryIndex(m, last), 1);
      m.entries.splice(entryIndex(m, dest[dest.length - 1]), 0, e);
      return t;
    }
    case "reorderKeys": {
      const m = map(t, path);
      const first = a[0].filter((k) => m.entries.some(([x]) => isKey(x, k)))
        .map((k) => m.entries[entryIndex(m, k)]);
      m.entries = [...first, ...m.entries.filter((e) => !first.includes(e))];
      return t;
    }
    case "appendValue": seq(t, path).items.push({ want: a[0] }); return t;
    case "prependValue": seq(t, path).items.unshift({ want: a[0] }); return t;
    case "deleteItem": {
      const s = seq(t, path);
      if (a[0] < 0 || a[0] >= s.items.length) throw new Error(`no item ${a[0]}`);
      s.items.splice(a[0], 1);
      emptied(t, path);
      return t;
    }
    case "moveItem": {
      const s = seq(t, path);
      const [x] = s.items.splice(a[0], 1);
      s.items.splice(a[1], 0, x);
      return t;
    }
    case "reorderItems": {
      const s = seq(t, path);
      const old = s.items.slice();
      s.items = a[0].map((i) => old[i]);
      return t;
    }
    case "setSequence": seq(t, path).items = a[0].map((v) => ({ want: v })); return t;
    default: throw new Error(`no reading for ${c.op}`);
  }
}

// ── comparing ────────────────────────────────────────────────────────────

function sameTree(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Why tree `got` is not `want` (a tree, possibly holding `{ want }`
 *  values, `added` entries and `emptied` containers), or null. */
function match(got, want, path, o) {
  if ("want" in want) return value(got, want.want, path, o);
  if (want.emptied && (got.kind === "null" || isEmpty(got, want.kind, o))) return null;
  if (want.kind === "map") {
    if (got.kind !== "map") return `${path}: want a mapping, got ${got.kind}`;
    const added = want.entries.filter((e) => e.added);
    const has = (k) => got.entries.some(([x]) => sameTree(x, k));
    const kept = want.entries.filter((e) => !e.added && !(e[1].emptied && !has(e[0])));
    const rest = got.entries.filter(([k]) => !added.some(([a]) => sameTree(a, k)));
    if (rest.length !== kept.length) return `${path}: want ${kept.length + added.length} entries, got ${got.entries.length}`;
    for (const [i, [k, v]] of kept.entries()) {
      // Order is asked about only by a move or reorder; elsewhere a key
      // may move as a side effect (a TOML table first named by a header
      // the edit removed).
      const e = o.ordered ? rest[i] : rest.find(([x]) => sameTree(x, k));
      if (!e || !sameTree(e[0], k)) return o.ordered ? `${path}: entry ${i} is ${show(rest[i][0])}, want ${show(k)}` : `${path}: no key ${show(k)}`;
      const m = match(e[1], v, `${path}.${show(k)}`, o);
      if (m) return m;
    }
    for (const [k, v] of added) {
      const e = got.entries.find(([x]) => sameTree(x, k));
      if (!e) return `${path}: no new key ${show(k)}`;
      const m = match(e[1], v, `${path}.${show(k)}`, o);
      if (m) return m;
    }
    return null;
  }
  if (want.kind === "seq") {
    if (want.items.length === 0 && isEmpty(got, "seq", o)) return null;
    if (got.kind !== "seq") return `${path}: want a sequence, got ${got.kind}`;
    if (got.items.length !== want.items.length) return `${path}: want ${want.items.length} items, got ${got.items.length}`;
    for (const [i, w] of want.items.entries()) {
      const m = match(got.items[i], w, `${path}[${i}]`, o);
      if (m) return m;
    }
    return null;
  }
  return sameTree(got, want) ? null : `${path}: ${show(got)}, want ${show(want)} as it was`;
}

/** Whether `t` is an empty container of `kind` as the format writes one. */
function isEmpty(t, kind, o) {
  if (t.kind === kind) return (t.entries ?? t.items).length === 0;
  if (o.either && (t.kind === "map" || t.kind === "seq")) return (t.entries ?? t.items).length === 0;
  return o.strings && t.kind === "string" && t.value === "";
}

/** Why tree `t` does not hold the JSON value `v`, or null. */
function value(t, v, path, o) {
  const no = `${path}: ${show(t)}, want ${JSON.stringify(v)}`;
  if (v === null) return t.kind === "null" ? null : no;
  if (Array.isArray(v)) {
    if (v.length === 0) return isEmpty(t, "seq", o) ? null : no;
    if (t.kind !== "seq" || t.items.length !== v.length) return no;
    for (const [i, x] of v.entries()) {
      const m = value(t.items[i], x, `${path}[${i}]`, o);
      if (m) return m;
    }
    return null;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return isEmpty(t, "map", o) ? null : no;
    if (t.kind !== "map" || t.entries.length !== keys.length) return no;
    for (const k of keys) {
      const e = t.entries.find(([x]) => isKey(x, k));
      if (!e) return `${path}: no key ${JSON.stringify(k)}`;
      const m = value(e[1], v[k], `${path}.${k}`, o);
      if (m) return m;
    }
    return null;
  }
  if (typeof v === "string") return t.kind === "string" && t.value === v ? null : no;
  // A format whose every scalar is a string holds 42 as "42".
  if (o.strings && t.kind === "string") return t.value === String(v) ? null : no;
  if (typeof v === "boolean") return t.kind === "bool" && t.value === v ? null : no;
  if (typeof v === "number") {
    if (t.kind !== "int" && t.kind !== "float") return no;
    return Number(t.raw.replaceAll("_", "")) === v ? null : no;
  }
  return no;
}

function show(t) {
  if (!t || typeof t !== "object") return String(t);
  if ("want" in t) return JSON.stringify(t.want);
  if (t.kind === "string") return JSON.stringify(t.value);
  if (t.kind === "int" || t.kind === "float") return t.raw;
  if (t.kind === "bool") return String(t.value);
  if (t.kind === "ext") return `${t.ext} ${t.text}`;
  return t.kind;
}
