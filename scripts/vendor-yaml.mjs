// Vendor the yaml-test-suite into suites/yaml/parse/ from its `data`
// branch, where every case is already expanded to files: `in.yaml` (the
// input, its whitespace placeholders decoded), `in.json` (the expected
// value, where the case has a JSON reading), `error` (present when the
// input must be refused) and `test.event` (the event stream).
//
//   node scripts/vendor-yaml.mjs [<yaml-test-suite checkout on its data branch>]
//
// A case is sorted by upstream's own markings, with no YAML parser:
//
//   accept/<id>.yaml (+ <id>.json)   one document; must parse
//   reject/<id>.yaml                 one document; has an `error` file
//   stream/<id>.yaml                 two or more `+DOC` events; must parse
//   reject-stream/<id>.yaml          a stream with an `error` file
//
// A case with several inputs is `<id>/00`, `<id>/01`… upstream, and
// `<id>`, `<id>-1`… here (the names fig's `testdata/yaml` used).
// `OUT_OF_SCOPE` lists a case fig does not hold itself to; it goes to
// `out-of-scope/`, which no check reads. It is empty today.
//
// This replaces fig's tools/gen_yaml_conformance.zig, which expanded the
// suite's `src/` meta-files by parsing them with fig. That tool's
// placeholder decoder kept the newline after a `↵`, so eleven of fig's
// accept inputs (5GBF, 8G76, B3HG, G992, JEF9, K858, M9B4, NHX8, P94K, T5N4
// and XV9V) carried extra trailing blank lines; these are upstream's bytes.
import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { freshCorpus, markOutside, parseDir, stamp, upstream } from "../lib/vendor.mjs";

const URL = "https://github.com/yaml/yaml-test-suite";
// The data branch as of release data-2022-01-17; `src/` on main has not
// changed since, so this is the current suite.
const COMMIT = "6ad3d2c62885d82fc349026c136ef560838fdf3d";
const OUT_OF_SCOPE = {}; // { "<case>": "<reason>" }

const up = upstream(URL, COMMIT, process.argv[2]);
const dirs = Object.fromEntries(["accept", "reject", "stream", "reject-stream"].map((d) => [d, freshCorpus("yaml", d)]));
const counts = { accept: 0, reject: 0, stream: 0, "reject-stream": 0, expected: 0, "out-of-scope": 0 };

for (const id of readdirSync(up.dir).filter((d) => /^[0-9A-Z]{4}$/.test(d)).sort()) {
  const top = join(up.dir, id);
  const cases = existsSync(join(top, "in.yaml"))
    ? [[id, top]]
    : readdirSync(top).filter((s) => /^\d+$/.test(s)).sort((a, b) => a - b)
      .map((s) => [Number(s) === 0 ? id : `${id}-${Number(s)}`, join(top, s)]);
  for (const [name, dir] of cases) {
    const fails = existsSync(join(dir, "error"));
    const docs = (readFileSync(join(dir, "test.event"), "utf8").match(/^\s*\+DOC/gm) ?? []).length;
    let into = docs >= 2 ? (fails ? "reject-stream" : "stream") : fails ? "reject" : "accept";
    if (OUT_OF_SCOPE[name]) {
      into = "out-of-scope";
      dirs[into] ??= freshCorpus("yaml", into);
    }
    copyFileSync(join(dir, "in.yaml"), join(dirs[into], `${name}.yaml`));
    counts[into]++;
    // The expected value, for a single document only: a stream's `in.json`
    // is one JSON text per document, which no check reads yet.
    if (into === "accept" && existsSync(join(dir, "in.json"))) {
      copyFileSync(join(dir, "in.json"), join(dirs[into], `${name}.json`));
      counts.expected++;
    }
  }
}
if (Object.keys(OUT_OF_SCOPE).length) {
  writeFileSync(join(dirs["out-of-scope"], "README.md"),
    Object.entries(OUT_OF_SCOPE).map(([k, v]) => `- ${k}: ${v}`).join("\n") + "\n");
}
// The licence is on main, not on the data branch.
const license = up.show("origin/main:License") ?? up.show("main:License");
if (license) writeFileSync(join(parseDir("yaml"), "LICENSE"), license);
else console.error("vendor-yaml: no License on main in this checkout; LICENSE left as it was");
stamp("yaml", { upstream: URL, branch: "data", commit: up.commit });
markOutside("yaml");
up.done();
console.error(`vendor-yaml: ${JSON.stringify(counts)}`);
