// The fig package the library tier runs on: $FIG_PACKAGE, else the
// `bindings/typescript` of a fig checkout beside this one. Loaded from
// source, so node needs `--conditions=fig-source`.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const pkg = resolve(process.env.FIG_PACKAGE ?? join(root, "..", "fig", "bindings", "typescript"));
export const fig = await import(pathToFileURL(join(pkg, "src", "index.ts")).href);

/** The package's own module for a language (`languages/<name>.js`). */
export async function languageModule(name, dir = join(pkg, "languages")) {
  return (await import(pathToFileURL(join(dir, `${name}.js`)).href)).default;
}

export const languages = JSON.parse(readFileSync(join(root, "languages.json"), "utf8"));
export const suiteDir = (suite) => join(root, "suites", suite);
