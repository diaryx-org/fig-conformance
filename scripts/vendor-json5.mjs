// Vendor json5-tests into suites/json5/parse/cases/.
//
//   node scripts/vendor-json5.mjs [<json5-tests checkout>]
//
// The suite says a case's outcome by its extension (its README): `.json`
// is JSON, so valid JSON5; `.json5` is a JSON5 feature; `.js` is ES5 that
// JSON5 forbids; `.txt` is not ES5. The manifest's checks select by the
// same extensions. Each category directory is flattened into the name
// (`numbers/hexadecimal.json5` → `numbers__hexadecimal.json5`), as fig's
// `testdata/json5` had it, and every file is identical to that. `todo/`
// holds what the JSON5 reference implementation does not do yet, and is
// left out; so are `.errorSpec` files, which pin error positions, and
// messages are not compared here.
import { copyFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { freshCorpus, markOutside, parseDir, stamp, upstream } from "../lib/vendor.mjs";

const URL = "https://github.com/json5/json5-tests";
const COMMIT = "ceb24d4080137d70833f86c25659c1331b80a387"; // 2026-02-20
const EXTS = new Set(["json", "json5", "js", "txt"]);

const up = upstream(URL, COMMIT, process.argv[2]);
const into = freshCorpus("json5", "cases");
let n = 0;
for (const group of readdirSync(up.dir).sort()) {
  if (group.startsWith(".") || group === "todo" || !statSync(join(up.dir, group)).isDirectory()) continue;
  for (const file of readdirSync(join(up.dir, group)).sort()) {
    if (!EXTS.has(file.slice(file.lastIndexOf(".") + 1))) continue;
    copyFileSync(join(up.dir, group, file), join(into, `${group}__${file}`));
    n++;
  }
}
copyFileSync(join(up.dir, "LICENSE.md"), join(parseDir("json5"), "LICENSE.md"));
stamp("json5", { upstream: URL, commit: up.commit });
markOutside("json5");
up.done();
console.error(`vendor-json5: ${n} cases`);
