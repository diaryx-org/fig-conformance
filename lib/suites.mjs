// The suites, and the dialect each scores: `languages.json` maps a suite
// to its dialect and its edit sources' extension (and, for fig's adapter,
// the language module that serves it).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const languages = JSON.parse(readFileSync(join(root, "languages.json"), "utf8"));
export const suiteDir = (suite) => join(root, "suites", suite);
