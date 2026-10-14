// Score an implementation against the parse suites.
//
//   npm run parse [-- --command <cmd> | --decoder <cmd> --dialects <a,b>
//                    | --languages <dir>] [--failures <file>] [--json]
//                 [--check <scores file>] [suite…]
//   npm run parse:compiled [-- …]       (FIG_REFERENCE_WASM set)
//
// A suite is `suites/<suite>/parse/suite.json` and its corpora (see
// lib/parse.mjs for the check kinds). The implementation is any adapter
// (lib/impl/, docs/adapters.md): a JSON-lines command, a toml-test
// decoder, or by default fig. fig is either the formats compiled into the
// module the package loads (`parse:compiled` swaps in a module with every
// format compiled in), or language modules registered into the package's
// own module, which compiles none: by default the package's JavaScript ones
// (`js/`), else `<dir>/<module>.js`, or `<dir>/<package>/js/<package>.js`
// for a directory laid out as fig's `languages/`, for each module
// `languages.json` names. A dialect the module can already read is not
// registered over.
//
// One line per check: cases that came out right, of all cases. Cases a
// manifest marks outside the contract (bytes that are not UTF-8, which a
// host refuses before any language sees them) are tallied after it. A check
// the implementation cannot run at all (a dialect or a method it lacks)
// says why and scores nothing.
// `--json` prints the scores instead, in the shape `scores/*.json` holds;
// `--check <file>` exits non-zero if any score there is higher than now.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { languages, suiteDir } from "../lib/suites.mjs";
import { NotRunnable, runCheck } from "../lib/parse.mjs";
import { IMPL_OPTIONS, implFrom } from "../lib/impl/index.mjs";

const { values: opts, positionals: only } = parseArgs({
  options: {
    ...IMPL_OPTIONS, failures: { type: "string" },
    json: { type: "boolean" }, check: { type: "string" },
  },
  allowPositionals: true,
});

const impl = await implFrom(opts, { quiet: opts.json });

const suites = languages.map((l) => l.suite)
  .filter((s) => existsSync(join(suiteDir(s), "parse", "suite.json")))
  .filter((s) => !only.length || only.includes(s));

const scores = {};
const failures = {};
for (const suite of suites) {
  const base = join(suiteDir(suite), "parse");
  const manifest = JSON.parse(readFileSync(join(base, "suite.json"), "utf8"));
  for (const check of manifest.checks) {
    let score;
    try {
      const { failures: missed, ...counts } = await runCheck(impl, check, base, manifest.dialect);
      score = counts;
      if (missed.length) (failures[suite] ??= {})[check.name] = missed;
    } catch (e) {
      if (!(e instanceof NotRunnable)) throw e;
      score = { runnable: false, reason: e.message };
    }
    (scores[suite] ??= {})[check.name] = score;
    if (!opts.json) console.log(line(suite, check.name, score));
  }
}

function line(suite, name, s) {
  const head = `${suite.padEnd(11)} ${name.padEnd(14)}`;
  if (s.runnable === false) return `${head} not run: ${s.reason}`;
  const tally = `${String(s.correct).padStart(4)}/${String(s.total).padEnd(4)}`;
  return s.outside ? `${head} ${tally} outside the contract ${s.outside.correct}/${s.outside.total}` : `${head} ${tally}`;
}

impl.close?.();
if (opts.json) console.log(JSON.stringify(scores, null, 2));
if (opts.failures) writeFileSync(opts.failures, JSON.stringify(failures, null, 1) + "\n");

// The regression check: a recorded score is a floor. A check recorded as
// not runnable sets none; one recorded with a score must still run.
if (opts.check) {
  const recorded = JSON.parse(readFileSync(opts.check, "utf8"));
  const drops = [];
  for (const [suite, checks] of Object.entries(recorded)) {
    if (!suites.includes(suite)) continue;
    for (const [name, was] of Object.entries(checks)) {
      if (was.runnable === false) continue;
      const now = scores[suite]?.[name];
      if (!now) drops.push(`${suite} ${name}: recorded, but no such check now`);
      else if (now.runnable === false) drops.push(`${suite} ${name}: was ${was.correct}/${was.total}, now not run: ${now.reason}`);
      else if (now.correct < was.correct) drops.push(`${suite} ${name}: ${now.correct}/${now.total}, below the recorded ${was.correct}/${was.total}`);
      else if (was.outside && (now.outside?.correct ?? 0) < was.outside.correct) {
        drops.push(`${suite} ${name}: outside the contract ${now.outside?.correct ?? 0}, below the recorded ${was.outside.correct}`);
      }
    }
  }
  for (const d of drops) console.error(`parse: ${d}`);
  if (drops.length) process.exit(1);
  console.error(`parse: no score below ${opts.check}`);
}
