// fig as an implementation under test (docs/adapters.md): the fig package
// in-process, with a language module registered for every dialect its wasm
// module cannot already read. With no `languages` directory those are the
// package's JavaScript ones (`js/`); a module built with every format
// compiled in (FIG_REFERENCE_WASM, lib/reference-wasm.mjs) registers none.
//
// Imported only when fig is the implementation, so that scoring anything
// else needs no fig checkout.
import { fig, languageModule, languages } from "../fig.mjs";
import { run } from "../edits.mjs";

/** The fig implementation; `quiet` keeps a missing language module from
 *  being reported on stderr, and `register: false` registers none, for the
 *  recorder, whose reference is the compiled formats alone. */
export async function figImpl({ languages: dir, quiet = false, register = true } = {}) {
  const format = (name) => fig.formatByName(name);
  const readable = (name) => {
    const f = format(name);
    return f != null && fig.capabilities(f).read;
  };
  // With a dialect prefix the languages are the module's own copies
  // (lib/fig.mjs), so nothing is registered.
  if (register && !process.env.FIG_DIALECT_PREFIX) {
    const registered = new Set();
    for (const lang of languages) {
      if (registered.has(lang.module) || readable(lang.dialect)) continue;
      registered.add(lang.module);
      try {
        fig.registerLanguage(await languageModule(lang, dir));
      } catch (e) {
        if (!quiet) console.error(`fig: no ${lang.module} module (${e.code ?? e.message})`);
      }
    }
  }

  const parse = (bytes, f) => {
    try {
      return { ok: true, doc: fig.Document.parse(bytes, f) };
    } catch (e) {
      return { ok: false, why: message(e) };
    }
  };

  return {
    name: "fig",
    has: (dialect) => readable(dialect),
    async parse(dialect, bytes) {
      const doc = parse(bytes, format(dialect));
      if (!doc.ok) return doc;
      try {
        return { ok: true, tree: readTree(doc.doc) };
      } finally {
        doc.doc.dispose();
      }
    },
    async print(dialect, bytes, to) {
      const doc = parse(bytes, format(dialect));
      if (!doc.ok) return doc;
      try {
        return { ok: true, text: doc.doc.serialize(format(to)) };
      } catch (e) {
        return { ok: false, why: message(e) };
      } finally {
        doc.doc.dispose();
      }
    },
    // A fig before 6.0 has no stream splitter, and runs no stream check.
    split: typeof fig.splitStream === "function"
      ? async (dialect, bytes) => {
        try {
          return { ok: true, parts: fig.splitStream(bytes, format(dialect)).map((d) => [d.start, d.end]) };
        } catch (e) {
          return { ok: false, why: message(e) };
        }
      }
      : undefined,
    async edit(dialect, source, op, args) {
      return run(fig, source, format(dialect), { op, args });
    },
  };
}

// fig's ExtKind, by number, as the tree names it (lib/tree.mjs).
const EXT_NAMES = ["datetime", "datetime-local", "date-local", "time-local", "enum", "char", "number-special", "date", "data"];

/** The parsed document as a tree (lib/tree.mjs), read node by node through
 *  the `Document` API, so a number keeps its lexeme and the checks read its
 *  value, not a binding's conversion of it. */
function readTree(doc) {
  const { NodeKind: K } = fig;
  const node = (id) => {
    switch (doc.kind(id)) {
      case K.Null: return { kind: "null" };
      case K.Bool: return { kind: "bool", value: doc.asBool(id) };
      case K.Int: return { kind: "int", raw: doc.asNumberRaw(id) };
      case K.Float: return { kind: "float", raw: doc.asNumberRaw(id) };
      case K.String: return { kind: "string", value: doc.asString(id) };
      case K.Extended: {
        const { ext, text } = doc.asExtended(id);
        return { kind: "ext", ext: EXT_NAMES[ext] ?? `fig-${ext}`, text };
      }
      // The node API walks the document as written, so an alias is left
      // a reference rather than resolved.
      case K.Alias: return { kind: "alias" };
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

function message(e) {
  return String(e?.message ?? e).split("\n")[0].slice(0, 200);
}
