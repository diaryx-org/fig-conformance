// Any implementation, as a command that speaks JSON lines on its stdin and
// stdout (docs/adapters.md). It is started once and asked everything in
// turn: one request per line, one response per line, matched by `id`.
import { spawn } from "node:child_process";
import { malformed, fromTagged } from "../tree.mjs";
import { lines } from "../lines.mjs";

const METHODS = ["parse", "print", "split", "edit"];
// How long one request may take: $CONFORM_TIMEOUT seconds, else 60.
const TIMEOUT = Number(process.env.CONFORM_TIMEOUT ?? 60) * 1000;

/** The implementation behind `command`, a shell command line. */
export async function commandImpl(command) {
  const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  let next = 0, dead = null;
  const fail = (why) => {
    dead ??= why;
    for (const { reject } of pending.values()) reject(new Error(dead));
    pending.clear();
  };
  child.on("error", (e) => fail(`${command}: ${e.message}`));
  child.on("exit", (code, signal) => fail(`${command} exited (${signal ?? code})`));
  child.stdin.on("error", () => {});
  lines(child.stdout, (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return fail(`${command} wrote a line that is not JSON: ${line.slice(0, 120)}`);
    }
    const p = pending.get(msg.id);
    if (!p) return fail(`${command} answered an id it was not asked: ${JSON.stringify(msg.id)}`);
    pending.delete(msg.id);
    p.resolve(msg);
  });
  const ask = (method, params) => {
    if (dead) return Promise.reject(new Error(dead));
    const id = next++;
    return new Promise((resolve, reject) => {
      // An adapter that loses a request would hang the run; it fails it
      // instead, and says which.
      const timer = setTimeout(() => fail(`${command} did not answer request ${id} (${method}) within ${TIMEOUT / 1000}s`), TIMEOUT);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      child.stdin.write(JSON.stringify({ id, method, ...params }) + "\n");
    });
  };

  const hello = await ask("hello", { protocol: 1 });
  const dialects = new Set(hello.dialects ?? []);
  const methods = new Set(hello.methods ?? ["parse"]);
  const source = (bytes) => {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    try {
      return { source: text.decode(bytes) };
    } catch {
      return { source_base64: Buffer.from(bytes).toString("base64") };
    }
  };
  // A response that breaks the protocol fails its case and says how, but
  // stops nothing else.
  const refusal = (r) => ({ ok: false, why: String(r.error ?? "refused").split("\n")[0].slice(0, 200) });

  const impl = {
    name: hello.name ?? command,
    has: (dialect) => dialects.has(dialect),
    close: () => child.stdin.end(),
  };
  if (methods.has("parse")) {
    impl.parse = async (dialect, bytes) => {
      const r = await ask("parse", { dialect, ...source(bytes) });
      if (!r.ok) return refusal(r);
      let tree;
      try {
        tree = r.tree ?? (r.tagged !== undefined ? fromTagged(r.tagged) : undefined);
      } catch (e) {
        return { ok: false, why: `protocol: ${e.message}` };
      }
      if (tree === undefined) return { ok: false, why: "protocol: a parse answered ok with no tree" };
      const bad = malformed(tree);
      return bad ? { ok: false, why: `protocol: ${bad}` } : { ok: true, tree };
    };
  }
  if (methods.has("print")) {
    impl.print = async (dialect, bytes, to) => {
      const r = await ask("print", { dialect, to, ...source(bytes) });
      if (!r.ok) return refusal(r);
      return typeof r.text === "string" ? { ok: true, text: r.text } : { ok: false, why: "protocol: a print answered ok with no text" };
    };
  }
  if (methods.has("split")) {
    impl.split = async (dialect, bytes) => {
      const r = await ask("split", { dialect, ...source(bytes) });
      if (!r.ok) return refusal(r);
      return Array.isArray(r.parts) ? { ok: true, parts: r.parts } : { ok: false, why: "protocol: a split answered ok with no parts" };
    };
  }
  if (methods.has("edit")) {
    impl.edit = async (dialect, src, op, args) => {
      const r = await ask("edit", { dialect, source: src, op, args });
      if (r.ok) return typeof r.source === "string" ? { ok: true, out: r.source } : { ok: false, status: "protocol: an edit answered ok with no source" };
      return r.at ? { ok: false, status: r.status ?? "Refused", at: r.at } : { ok: false, status: r.status ?? "Refused" };
    };
  }
  for (const m of methods) if (!METHODS.includes(m)) console.error(`${impl.name}: ignoring unknown method ${m}`);
  return impl;
}
