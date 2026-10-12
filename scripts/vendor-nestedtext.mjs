// Vendor the official NestedText tests into suites/nestedtext/parse/.
//
//   node scripts/vendor-nestedtext.mjs [<nestedtext_tests checkout>]
//
// Upstream is one file, `tests.json`: `{"load_tests": {<name>: {load_in,
// load_out, load_err, …}}}`, `load_in` the source in base64. A case whose
// `load_err` is a non-empty object must be refused; any other must load to
// `load_out`, plain JSON (`null` for an empty document). Each is expanded
// to a file, so the runner reads it as it reads every other corpus:
//
//   valid/<name>.nt + <name>.json    the source's bytes, and `load_out`
//   invalid/<name>.nt                the source's bytes
//
// `load_err`'s message and position are not kept: the contract carries a
// refusal, not its wording. fig's scoreboard read the same `tests.json`.
//
// The upstream repository carries no licence file. NestedText is MIT, and
// `LICENSE` here is the one fig vendored beside its copy; this script
// leaves it as it is.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshCorpus, markOutside, stamp, upstream } from "../lib/vendor.mjs";

const URL = "https://github.com/KenKundert/nestedtext_tests";
const COMMIT = "5d1d91a24f7a54bcff249d090af47c73bb700d48"; // 2026-09-18

const up = upstream(URL, COMMIT, process.argv[2]);
const { load_tests: tests } = JSON.parse(readFileSync(join(up.dir, "tests.json"), "utf8"));
const valid = freshCorpus("nestedtext", "valid");
const invalid = freshCorpus("nestedtext", "invalid");
const counts = { valid: 0, invalid: 0 };
for (const name of Object.keys(tests).sort()) {
  const t = tests[name];
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`vendor-nestedtext: case name ${JSON.stringify(name)} is not a safe file name`);
  if (typeof t.load_in !== "string") continue;
  const source = Buffer.from(t.load_in, "base64");
  const fails = t.load_err != null && typeof t.load_err === "object" && Object.keys(t.load_err).length > 0;
  writeFileSync(join(fails ? invalid : valid, `${name}.nt`), source);
  if (!fails) {
    // NestedText has only strings, so `load_out` has no number whose
    // spelling JSON.stringify could change; say so if that ever stops
    // being true, rather than writing a different expectation.
    JSON.stringify(t.load_out ?? null, (k, v) => {
      if (typeof v === "number" || typeof v === "boolean") throw new Error(`vendor-nestedtext: ${name}: load_out holds a ${typeof v}`);
      return v;
    });
    writeFileSync(join(valid, `${name}.json`), JSON.stringify(t.load_out ?? null, null, 1) + "\n");
  }
  counts[fails ? "invalid" : "valid"]++;
}
stamp("nestedtext", { upstream: URL, commit: up.commit });
markOutside("nestedtext");
up.done();
console.error(`vendor-nestedtext: ${JSON.stringify(counts)}`);
