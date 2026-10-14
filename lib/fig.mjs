// The fig package the library tier runs on: $FIG_PACKAGE, else the
// `bindings/typescript` of a fig checkout beside this one. Loaded from
// source, so node needs `--conditions=fig-source`.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const pkg = resolve(process.env.FIG_PACKAGE ?? join(root, "..", "fig", "bindings", "typescript"));
const module = await import(pathToFileURL(join(pkg, "src", "index.ts")).href);
/** The package, with every dialect name prefixed by $FIG_DIALECT_PREFIX when
 *  it is set: a fig wasm built `-Dcontract-copies=true` registers each
 *  compiled language again through its contract as `c-<name>`, and
 *  `FIG_DIALECT_PREFIX=c-` scores those instead. */
export const fig = process.env.FIG_DIALECT_PREFIX
  ? { ...module, formatByName: (name) => module.formatByName(process.env.FIG_DIALECT_PREFIX + name) }
  : module;

/** The module for `lang`, an entry of `languages.json`: the package's
 *  JavaScript one (`js/<module>.js`), or with `dir` any other, as
 *  `<dir>/<module>.js` or as a directory of language packages laid out as
 *  fig's `languages/` is, `<dir>/<package>/js/<package>.js`, which is fig's
 *  own Zig, a WebAssembly module per language. `package` is the language
 *  package a dialect belongs to where it is not `module`'s own (JSONC and
 *  JSON5 are dialects of fig's `json`). */
export async function languageModule(lang, dir = join(pkg, "js")) {
  const flat = join(dir, `${lang.module}.js`);
  const name = lang.package ?? lang.module;
  const path = existsSync(flat) ? flat : join(dir, name, "js", `${name}.js`);
  return (await import(pathToFileURL(path).href)).default;
}

export { languages, suiteDir } from "./suites.mjs";
