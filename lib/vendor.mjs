// What the vendoring scripts share: fetch an upstream at a pinned commit,
// write a corpus directory from scratch, and mark the cases a suite cannot
// put through the contract.
//
// No script parses with fig. Each reads its upstream's files as bytes and
// decides a case's outcome from where upstream put it (a directory, a file
// name, an `error` file), so a parser change can never move a case.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Not `lib/fig.mjs`'s: that one loads fig, and vendoring must not need it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = (suite) => join(root, "suites", suite);
/** `suites/<suite>/parse`, where a suite's manifest, licence and corpora live. */
export const parseDir = (suite) => join(suiteDir(suite), "parse");

/** A checkout of `url` at `commit`: `local` if given (a checkout the caller
 *  already has, used at whatever it has checked out, which is what the
 *  manifest then records), else a fresh clone into a scratch directory that
 *  `done()` removes. */
export function upstream(url, commit, local) {
  if (local) {
    const head = git(local, "rev-parse", "HEAD");
    if (!head.startsWith(commit)) console.error(`vendor: ${local} is at ${head.slice(0, 12)}, not the pinned ${commit.slice(0, 12)}`);
    return { dir: local, commit: head, show: (spec) => show(local, spec), done() {} };
  }
  const scratch = mkdtempSync(join(tmpdir(), "fig-conformance-vendor-"));
  const dir = join(scratch, "upstream");
  console.error(`vendor: cloning ${url} at ${commit.slice(0, 12)}`);
  execFileSync("git", ["clone", "--quiet", "--no-checkout", url, dir], { stdio: "inherit" });
  git(dir, "checkout", "--quiet", commit);
  return {
    dir, commit: git(dir, "rev-parse", "HEAD"), show: (spec) => show(dir, spec),
    done: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

/** `git show <spec>` (`<rev>:<path>`) as bytes, or null where the checkout
 *  lacks it (a shallow clone of one branch, say). */
function show(dir, spec) {
  try {
    return execFileSync("git", ["-C", dir, "show", spec], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args]).toString().trim();
}

/** `suites/<suite>/parse/<sub>`, emptied and made again: a vendoring script
 *  only writes, so a case upstream has since dropped must not linger. */
export function freshCorpus(suite, sub) {
  const dir = join(parseDir(suite), sub);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Record where a suite's corpus came from in its manifest, so the scores
 *  recorded against it can be read against a known upstream. */
export function stamp(suite, source) {
  const path = join(parseDir(suite), "suite.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.source = { ...manifest.source, ...source };
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

/** Mark each check's cases that are not valid UTF-8 as outside the
 *  contract: the wire carries text, so such bytes are the host's to refuse
 *  before any language sees them. A property of the bytes, so finding them
 *  needs no parser. Only a check that wants the case parsed is affected: a
 *  host's refusal is still the right answer where a refusal is expected.
 *  Rewrites each check's `outside` map in place. */
export function markOutside(suite) {
  const base = parseDir(suite);
  const path = join(base, "suite.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let marked = 0;
  for (const check of manifest.checks) {
    const outside = {};
    const files = check.kind.startsWith("refuses") ? [] : readdirSync(join(base, check.corpus)).sort();
    for (const file of files) {
      if (!caseFile(check, file) || check.refused?.includes(file)) continue;
      try {
        utf8.decode(readFileSync(join(base, check.corpus, file)));
      } catch {
        outside[file] = "not UTF-8: the wire carries text, so the host refuses it";
      }
    }
    if (Object.keys(outside).length) { check.outside = outside; marked += Object.keys(outside).length; }
    else delete check.outside;
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  if (marked) console.error(`vendor: ${suite}: ${marked} case-check pairs marked outside the contract`);
}

/** Whether `file` is one of `check`'s cases: its extension is the check's,
 *  or one of them. The runner selects cases by the same rule. */
export function caseFile(check, file) {
  const exts = [check.ext].flat();
  return exts.some((e) => file.endsWith(`.${e}`));
}
