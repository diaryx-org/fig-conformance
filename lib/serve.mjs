// Serve an implementation over the JSON-lines protocol (docs/adapters.md)
// on stdin and stdout: what a JavaScript tool needs to be scored with
// `--command`, and how fig itself is served to check the protocol.
//
//   import { serve } from "fig-conformance/lib/serve.mjs";
//   serve({ name: "mytool", dialects: ["toml"], parse(dialect, bytes) { … } });
//
// The object is an implementation as lib/impl/ makes one, with `dialects`
// in place of `has`: `parse`, `print`, `split` and `edit` are each
// optional, and may return a promise.
import { lines } from "./lines.mjs";

export function serve(impl) {
  const methods = ["parse", "print", "split", "edit"].filter((m) => typeof impl[m] === "function");
  const bytes = (req) => (req.source_base64 !== undefined ? Buffer.from(req.source_base64, "base64") : Buffer.from(req.source));
  const handlers = {
    hello: async () => ({ name: impl.name, dialects: impl.dialects, methods }),
    parse: async (r) => {
      const o = await impl.parse(r.dialect, bytes(r));
      return o.ok ? { ok: true, tree: o.tree } : { ok: false, error: o.why };
    },
    print: async (r) => {
      const o = await impl.print(r.dialect, bytes(r), r.to);
      return o.ok ? { ok: true, text: o.text } : { ok: false, error: o.why };
    },
    split: async (r) => {
      const o = await impl.split(r.dialect, bytes(r));
      return o.ok ? { ok: true, parts: o.parts } : { ok: false, error: o.why };
    },
    edit: async (r) => {
      const o = await impl.edit(r.dialect, r.source, r.op, r.args);
      return o.ok ? { ok: true, source: o.out } : { ok: false, status: o.status, ...(o.at ? { at: o.at } : {}) };
    },
  };
  // One request at a time, in order, so answers keep the order asked.
  let chain = Promise.resolve();
  lines(process.stdin, (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        return;
      }
      let res;
      try {
        const h = req.method === "hello" || methods.includes(req.method) ? handlers[req.method] : null;
        res = h ? await h(req) : { ok: false, error: `no method ${req.method}` };
      } catch (e) {
        res = { ok: false, error: String(e?.message ?? e) };
      }
      process.stdout.write(JSON.stringify({ id: req.id, ...res }) + "\n");
    });
  });
}
