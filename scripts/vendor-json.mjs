// Vendor JSONTestSuite into suites/json/parse/.
//
//   node scripts/vendor-json.mjs [<JSONTestSuite checkout>]
//
// Upstream's `test_parsing/` names each case by its outcome: `y_` must
// parse, `n_` must be refused, and `i_` is implementation-defined. They go
// to `accept/`, `reject/` and `edgecase/`. Which `i_` cases fig refuses is
// fig's decision, and is written in the manifest's `edgecase` check, not
// here. Every file is identical to fig's `testdata/json`.
import { copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { freshCorpus, markOutside, parseDir, stamp, upstream } from "../lib/vendor.mjs";

const URL = "https://github.com/nst/JSONTestSuite";
const COMMIT = "1ef36fa01286573e846ac449e8683f8833c5b26a"; // 2024-11-22

const up = upstream(URL, COMMIT, process.argv[2]);
const into = { y: freshCorpus("json", "accept"), n: freshCorpus("json", "reject"), i: freshCorpus("json", "edgecase") };
const counts = { y: 0, n: 0, i: 0 };
const dir = join(up.dir, "test_parsing");
for (const file of readdirSync(dir).sort()) {
  const outcome = file[0];
  if (!into[outcome] || file[1] !== "_" || !file.endsWith(".json")) continue;
  copyFileSync(join(dir, file), join(into[outcome], file));
  counts[outcome]++;
}
copyFileSync(join(up.dir, "LICENSE"), join(parseDir("json"), "LICENSE"));
stamp("json", { upstream: URL, commit: up.commit });
markOutside("json");
up.done();
console.error(`vendor-json: accept ${counts.y}, reject ${counts.n}, edgecase ${counts.i}`);
