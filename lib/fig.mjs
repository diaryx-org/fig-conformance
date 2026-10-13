// The fig package the library tier runs on: $FIG_PACKAGE, else the
// `bindings/typescript` of a fig checkout beside this one. Loaded from
// source, so node needs `--conditions=fig-source`.
import { readFileSync } from "node:fs";
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

/** The package's module for a language: the JavaScript one
 *  (`js/<name>.js`), or with `dir` any other — `<pkg>/languages` is fig's
 *  own Zig, compiled to a WebAssembly module per language. */
export async function languageModule(name, dir = join(pkg, "js")) {
  return (await import(pathToFileURL(join(dir, `${name}.js`)).href)).default;
}

export const languages = JSON.parse(readFileSync(join(root, "languages.json"), "utf8"));
export const suiteDir = (suite) => join(root, "suites", suite);
