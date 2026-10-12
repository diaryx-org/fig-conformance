// Vendor toml-test into suites/toml/parse/, one corpus per TOML version.
//
//   node scripts/vendor-toml.mjs [<toml-test checkout>]
//
// toml-test lists each version's cases in `tests/files-toml-<version>`:
// `valid/<group>/<name>.toml` with a sibling `.json` that tags every
// scalar `{"type": T, "value": V}`, and `invalid/<group>/<name>.toml`,
// which must be refused. A case is copied to
// `<version>/{valid,invalid}/<group>__<name>.{toml,json}`, the path
// flattened into the name as fig's `testdata/toml` had it. Version 1.1.0
// reclassifies some 1.0.0 cases, so each version is its own corpus.
//
// This is what fig's tools/gen_toml_conformance.zig did, which never parsed
// with fig either. COMMIT is the toml-test commit fig's `testdata/toml`
// and `testdata/toml-1.1.0` were vendored from (every file identical);
// moving it is a deliberate act, and the scores move with it.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { freshCorpus, markOutside, parseDir, stamp, upstream } from "../lib/vendor.mjs";

const URL = "https://github.com/toml-lang/toml-test";
const COMMIT = "af5f8052e9109206ad3977508263c97907f0797d"; // 2026-05-24
const VERSIONS = ["1.0.0", "1.1.0"];

const up = upstream(URL, COMMIT, process.argv[2]);
const tests = join(up.dir, "tests");
const counts = {};
for (const version of VERSIONS) {
  const base = freshCorpus("toml", version);
  const n = (counts[version] = { valid: 0, invalid: 0 });
  for (const line of readFileSync(join(tests, `files-toml-${version}`), "utf8").split("\n")) {
    const m = line.trim().match(/^(valid|invalid)\/(.+)\.(toml|json)$/);
    if (!m) continue;
    const [, kind, path, ext] = m;
    const to = join(base, kind, `${path.replaceAll("/", "__")}.${ext}`);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(tests, line.trim()), to);
    if (ext === "toml") n[kind]++;
  }
}
copyFileSync(join(up.dir, "LICENSE"), join(parseDir("toml"), "LICENSE"));
stamp("toml", { upstream: URL, commit: up.commit });
markOutside("toml");
up.done();
console.error(`vendor-toml: ${JSON.stringify(counts)}`);
