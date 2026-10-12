// Write the plist suite's oracles: for each `valid/<name>.plist`,
// `valid/<name>.json` is what `plutil -convert json` makes of it, verbatim.
//
//   node scripts/plist-oracles.mjs        (macOS; plutil is Apple's)
//
// The plist corpus has no upstream: it is fig's own, real system
// `Info.plist` files and hand-written cases, copied here from fig's
// `testdata/plist`. Its oracles are Apple's reader, not fig. `plutil`
// refuses JSON for a document with a `<date>` or `<data>` (JSON has
// neither) and for a bare scalar root, so `kitchen-sink.plist` and
// `root-string.plist` have no oracle, and the `oracle` check passes over
// them. Run this after adding a case; a changed oracle is a change in
// `plutil`, and worth reading.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseDir } from "../lib/vendor.mjs";

const dir = join(parseDir("plist"), "valid");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".plist")).sort()) {
  const out = join(dir, file.replace(/\.plist$/, ".json"));
  try {
    execFileSync("plutil", ["-convert", "json", "-o", out, join(dir, file)], { stdio: ["ignore", "ignore", "pipe"] });
    console.error(`plist-oracles: ${file}: oracle written`);
  } catch (e) {
    rmSync(out, { force: true });
    console.error(`plist-oracles: ${file}: plutil refuses (${String(e.stderr).trim().split("\n")[0]})`);
  }
}
