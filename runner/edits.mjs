// Score implementations of the languages against the recorded edit cases.
//
//   npm run edits [-- --languages <dir>] [--failures <file>] [suite…]
//
// Each language is a module exporting a fig `Language` object, found as
// `<dir>/<module>.js` (default: the fig package's own `languages/`), and
// registered into a fig module that compiles no format in. One line per
// suite: cases whose outcome matches, of all cases, and how many of those
// matches are to a recorded answer marked `suspect` (see lib/edits.mjs).
// `--failures` writes every mismatch, with what was expected and what came
// back.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fig, languageModule, languages, suiteDir } from "../lib/fig.mjs";
import { decode, run, same } from "../lib/edits.mjs";

const { values: opts, positionals: only } = parseArgs({
  options: { languages: { type: "string" }, failures: { type: "string" }, json: { type: "boolean" } },
  allowPositionals: true,
});

const registered = new Set();
const scores = {};
const failures = {};
for (const lang of languages) {
  if (only.length && !only.includes(lang.suite)) continue;
  // With a dialect prefix the languages are the fig module's own copies
  // (see lib/fig.mjs), so nothing is registered.
  if (!process.env.FIG_DIALECT_PREFIX && !registered.has(lang.module)) {
    fig.registerLanguage(await languageModule(lang.module, opts.languages));
    registered.add(lang.module);
  }
  const format = fig.formatByName(lang.dialect);
  const dir = join(suiteDir(lang.suite), "edits");
  const byOp = {};
  let correct = 0, total = 0, suspect = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const { source: name, cases } = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const source = readFileSync(join(dir, "sources", name), "utf8");
    for (const c of cases) {
      const got = run(fig, source, format, c);
      const o = (byOp[c.op] ??= { correct: 0, total: 0 });
      total++; o.total++;
      const expect = decode(source, c.expect);
      if (same(got, expect)) { correct++; o.correct++; if (c.suspect) suspect++; }
      else (failures[lang.suite] ??= []).push({ source: name, id: c.id, op: c.op, args: c.args, expect, got });
    }
  }
  scores[lang.suite] = { correct, total, suspect, byOp };
  if (!opts.json) {
    const misses = Object.entries(byOp).filter(([, o]) => o.correct < o.total)
      .map(([op, o]) => `${op} ${o.correct}/${o.total}`).join(", ");
    const note = suspect ? `(${suspect} of them suspect) ` : "";
    console.log(`${lang.suite.padEnd(11)} ${String(correct).padStart(5)}/${String(total).padEnd(5)} ${note}${misses}`);
  }
}
if (opts.json) console.log(JSON.stringify(scores, null, 2));
if (opts.failures) writeFileSync(opts.failures, JSON.stringify(failures, null, 1) + "\n");
