// Any implementation, as a toml-test decoder: a command run once per case,
// given the document on stdin, that prints the tagged JSON of what it read
// and exits 0, or exits non-zero to refuse it (docs/adapters.md). Every
// decoder written for toml-test runs the TOML suite as it is, and a decoder
// for another language need only write the same JSON.
//
// The command is run through the shell, with `{dialect}` in it replaced by
// the dialect asked for. Only parse checks are runnable this way.
import { spawn } from "node:child_process";
import { fromTagged, malformed } from "../tree.mjs";

/** The decoder `command`, for the dialects named in `dialects`. */
export function decoderImpl(command, dialects) {
  const served = new Set(dialects);
  return {
    name: command,
    has: (dialect) => served.has(dialect),
    async parse(dialect, bytes) {
      const { code, stdout, stderr } = await runOnce(command.replaceAll("{dialect}", dialect), bytes);
      if (code !== 0) return { ok: false, why: stderr.split("\n").find((l) => l.trim())?.slice(0, 200) ?? `exit ${code}` };
      let tree;
      try {
        tree = fromTagged(JSON.parse(stdout));
      } catch (e) {
        return { ok: false, why: `protocol: ${e.message.slice(0, 160)}` };
      }
      const bad = malformed(tree);
      return bad ? { ok: false, why: `protocol: ${bad}` } : { ok: true, tree };
    },
  };
}

function runOnce(command, input) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    child.stdin.on("error", () => {});
    child.on("error", (e) => resolve({ code: -1, stdout: "", stderr: e.message }));
    child.on("close", (code, signal) => resolve({
      code: code ?? signal,
      stdout: Buffer.concat(out).toString(),
      stderr: Buffer.concat(err).toString(),
    }));
    child.stdin.end(input);
  });
}
