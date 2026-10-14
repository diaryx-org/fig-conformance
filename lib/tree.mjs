// The tree an implementation hands back for a parsed document, the one
// thing every check compares. It is plain JSON, so an implementation in any
// language can write it (docs/adapters.md):
//
//   { "kind": "null" }
//   { "kind": "bool",   "value": true }
//   { "kind": "int",    "raw": "0x1F" }      a number keeps its lexeme, so
//   { "kind": "float",  "raw": "1_000.5" }   the checks read its value
//   { "kind": "string", "value": "…" }
//   { "kind": "ext",    "ext": "datetime", "text": "1979-05-27T07:32:00Z" }
//   { "kind": "seq",    "items": [ <tree>, … ] }
//   { "kind": "map",    "entries": [ [ <key tree>, <value tree> ], … ] }
//   { "kind": "alias" }                      a YAML alias left unresolved
//
// An empty document is `{ "kind": "null" }`. A map keeps its entries in
// document order, duplicates included, and its keys are trees, since a YAML
// key need not be a string. An implementation may resolve an alias to the
// tree its anchor names instead of writing `alias`. `ext` is a scalar that is none of the others;
// its name says which:
//
//   datetime, datetime-local, date-local, time-local   TOML's, YAML 1.1's
//   number-special                                     JSON5's Infinity, NaN
//   enum, char                                         ZON's .name and 'c'
//   date, data                                         plist's <date>, <data>
//
// An implementation that writes toml-test's tagged JSON instead
// (`{"type": "integer", "value": "42"}` leaves, plain objects and arrays)
// is read through `fromTagged`.

export const EXT = ["datetime", "datetime-local", "date-local", "time-local", "enum", "char", "number-special", "date", "data"];

const TAGGED_TYPES = new Set(["null", "string", "integer", "float", "bool", "datetime", "datetime-local", "date-local", "time-local"]);

/** toml-test's tagged JSON, already parsed, as a tree. Mapping order is
 *  JSON's, which is all a tagged document has to say about it. */
export function fromTagged(v) {
  if (Array.isArray(v)) return { kind: "seq", items: v.map(fromTagged) };
  if (v === null || typeof v !== "object") throw new Error(`tagged JSON has a bare ${v === null ? "null" : typeof v}`);
  const keys = Object.keys(v);
  if (keys.length === 2 && typeof v.type === "string" && typeof v.value === "string" && TAGGED_TYPES.has(v.type)) {
    switch (v.type) {
      case "null": return { kind: "null" };
      case "string": return { kind: "string", value: v.value };
      case "bool": return { kind: "bool", value: v.value === "true" };
      case "integer": return { kind: "int", raw: v.value };
      case "float": return { kind: "float", raw: v.value };
      default: return { kind: "ext", ext: v.type, text: v.value };
    }
  }
  return { kind: "map", entries: keys.map((k) => [{ kind: "string", value: k }, fromTagged(v[k])]) };
}

/** Why `t` is not a well-formed tree, or null. Checked on what a foreign
 *  implementation sends, so a malformed answer fails its case by name. */
export function malformed(t, path = "$") {
  if (t === null || typeof t !== "object") return `${path}: not a tree node`;
  switch (t.kind) {
    case "null": case "alias": return null;
    case "bool": return typeof t.value === "boolean" ? null : `${path}: bool without a boolean value`;
    case "int": case "float": return typeof t.raw === "string" ? null : `${path}: ${t.kind} without its raw lexeme`;
    case "string": return typeof t.value === "string" ? null : `${path}: string without a string value`;
    case "ext": return typeof t.ext === "string" && typeof t.text === "string" ? null : `${path}: ext needs ext and text`;
    case "seq":
      if (!Array.isArray(t.items)) return `${path}: seq without items`;
      for (const [i, x] of t.items.entries()) {
        const m = malformed(x, `${path}[${i}]`);
        if (m) return m;
      }
      return null;
    case "map":
      if (!Array.isArray(t.entries)) return `${path}: map without entries`;
      for (const [i, e] of t.entries.entries()) {
        if (!Array.isArray(e) || e.length !== 2) return `${path}: entry ${i} is not [key, value]`;
        const m = malformed(e[0], `${path}{${i}}`) ?? malformed(e[1], `${path}[${i}]`);
        if (m) return m;
      }
      return null;
    default: return `${path}: unknown kind ${JSON.stringify(t.kind)}`;
  }
}
