// Generate every suite's edit cases from its sources and record what the
// compiled formats answer, as `suites/<suite>/edits/<source stem>.json`.
//
//   (cd ../fig && zig build wasm -Djson=true -Dyaml=true … --prefix /tmp/ref)
//   FIG_REFERENCE_WASM=/tmp/ref/bin/fig.wasm npm run record:edits [suite…]
//
// Rerun it when a compiled format's editor changes, and read the diff: an
// expectation that moves is a change every implementation must follow.
import { readdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fig, languages, suiteDir } from "../lib/fig.mjs";
import { encode, decode, generate, run, same, suspect } from "../lib/edits.mjs";

const only = process.argv.slice(2);
const suspects = [];
for (const lang of languages) {
  if (only.length && !only.includes(lang.suite)) continue;
  const format = fig.formatByName(lang.dialect);
  if (format == null || !fig.capabilities(format).edit) {
    console.error(`record-edits: ${lang.dialect} is not a compiled, editable format in this module; is FIG_REFERENCE_WASM a module with every format compiled in?`);
    process.exit(1);
  }
  const dir = join(suiteDir(lang.suite), "edits");
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f));
  let cases = 0, refused = 0, sources = 0;
  for (const file of readdirSync(join(dir, "sources")).sort()) {
    if (!file.endsWith(`.${lang.ext}`)) continue;
    const source = readFileSync(join(dir, "sources", file), "utf8");
    // What a case file carries is what is run: JSON has no NaN or
    // undefined, so the arguments go through it first.
    const generated = JSON.parse(JSON.stringify(generate(fig, source, format)));
    if (generated.length === 0) continue;
    const recorded = generated.map((c) => {
      const expect = run(fig, source, format, c);
      const why = suspect(fig, source, format, c, expect);
      if (why) suspects.push(`${lang.suite}/${file}: ${c.id}: ${why}`);
      const stored = encode(source, expect);
      if (!same(decode(source, stored), expect)) throw new Error(`record-edits: ${file}: ${c.id}: the splice does not round-trip`);
      return why ? { ...c, expect: stored, suspect: why } : { ...c, expect: stored };
    });
    // One case to a line, so a recording's diff is one line per moved case.
    writeFileSync(join(dir, `${file.slice(0, -(lang.ext.length + 1))}.json`),
      `{"source": ${JSON.stringify(file)}, "cases": [\n${recorded.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);
    sources++;
    cases += recorded.length;
    refused += recorded.filter((c) => !c.expect.ok).length;
  }
  console.error(`record-edits: ${lang.suite}: ${cases} cases from ${sources} sources, ${refused} refused`);
}
if (suspects.length) {
  console.error(`record-edits: ${suspects.length} recorded answers break an invariant, marked \`suspect\`:`);
  for (const s of suspects) console.error(`  ${s}`);
}
