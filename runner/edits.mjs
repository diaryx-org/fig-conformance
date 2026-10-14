// Score an implementation against the recorded edit cases.
//
//   npm run edits [-- --command <cmd> | --languages <dir>] [--failures <file>]
//                 [--json] [--exact-only] [suite…]
//
// The implementation is any adapter (lib/impl/, docs/adapters.md): by
// default fig, with its language modules from `--languages <dir>`
// (`<dir>/<module>.js`, or `<dir>/<package>/js/<package>.js` for a
// directory laid out as fig's `languages/`) or the package's JavaScript
// ones (`js/`).
//
// Two scores per suite:
//
//   exact     the outcome is the recorded one: the same bytes, or a refusal
//             with the same status. The recorded answers are fig's, so
//             this is parity with fig.
//   faithful  the edit did what it asked, read back through the
//             implementation's own parser, or both refused
//             (lib/faithful.mjs). A tool with its own style can reach it.
//
// One line per suite, and the ops that fell short of exact. Matches to a
// recorded answer marked `suspect` (lib/edits.mjs) are counted.
// `--failures` writes every case that is not exact, with what was expected,
// what came back, and why it is not faithful if it is not. `--exact-only`
// skips the faithful score, which parses every case twice more.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { languages, suiteDir } from "../lib/suites.mjs";
import { decode, same } from "../lib/edits.mjs";
import { unfaithful } from "../lib/faithful.mjs";
import { IMPL_OPTIONS, implFrom } from "../lib/impl/index.mjs";

const { values: opts, positionals: only } = parseArgs({
  options: { ...IMPL_OPTIONS, failures: { type: "string" }, json: { type: "boolean" }, "exact-only": { type: "boolean" } },
  allowPositionals: true,
});

const impl = await implFrom(opts, { quiet: opts.json });
if (typeof impl.edit !== "function") {
  console.error(`edits: ${impl.name} has no edit method, so it cannot run the edit suites`);
  process.exit(2);
}
const scores = {};
const failures = {};
for (const lang of languages) {
  if (only.length && !only.includes(lang.suite)) continue;
  if (!(await impl.has(lang.dialect))) {
    scores[lang.suite] = { runnable: false, reason: `no dialect named ${JSON.stringify(lang.dialect)}` };
    if (!opts.json) console.log(`${lang.suite.padEnd(11)} not run: ${impl.name} has no ${lang.dialect}`);
    continue;
  }
  const dir = join(suiteDir(lang.suite), "edits");
  const byOp = {};
  let correct = 0, faithful = 0, total = 0, suspect = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const { source: name, cases } = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const source = readFileSync(join(dir, "sources", name), "utf8");
    for (const c of cases) {
      const got = await impl.edit(lang.dialect, source, c.op, c.args);
      const o = (byOp[c.op] ??= { correct: 0, total: 0 });
      total++; o.total++;
      const expect = decode(source, c.expect);
      const exact = same(got, expect);
      if (exact) { correct++; o.correct++; if (c.suspect) suspect++; }
      const why = opts["exact-only"] ? undefined : await unfaithful(impl, lang, source, c, got, expect);
      if (why === null) faithful++;
      if (!exact) {
        (failures[lang.suite] ??= []).push({ source: name, id: c.id, op: c.op, args: c.args, expect, got, ...(why ? { unfaithful: why } : {}) });
      }
    }
  }
  scores[lang.suite] = opts["exact-only"] ? { correct, total, suspect, byOp } : { correct, faithful, total, suspect, byOp };
  if (!opts.json) {
    const misses = Object.entries(byOp).filter(([, o]) => o.correct < o.total)
      .map(([op, o]) => `${op} ${o.correct}/${o.total}`).join(", ");
    const note = suspect ? `(${suspect} of them suspect) ` : "";
    const f = opts["exact-only"] ? "" : `faithful ${String(faithful).padStart(5)}/${String(total).padEnd(5)} `;
    console.log(`${lang.suite.padEnd(11)} ${String(correct).padStart(5)}/${String(total).padEnd(5)} ${f}${note}${misses}`);
  }
}
impl.close?.();
if (opts.json) console.log(JSON.stringify(scores, null, 2));
if (opts.failures) writeFileSync(opts.failures, JSON.stringify(failures, null, 1) + "\n");
