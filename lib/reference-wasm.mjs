// `node --import ./lib/reference-wasm.mjs`: run the fig package on the wasm
// module at $FIG_REFERENCE_WASM in place of the one it inlines. Recording
// uses it with a module that compiles every format in (`zig build wasm
// -D<format>=true` for each), so the expectations are the compiled
// formats' answers.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const path = process.env.FIG_REFERENCE_WASM;
if (!path) throw new Error("reference-wasm: set FIG_REFERENCE_WASM to a fig.wasm");
const source = `export const WASM_BASE64 = ${JSON.stringify(readFileSync(path).toString("base64"))};\n`;

registerHooks({
  load(url, context, next) {
    if (url.endsWith("/src/wasm-bytes.ts")) return { format: "module", source, shortCircuit: true };
    return next(url, context);
  },
});
