// The implementation a runner scores, chosen on its command line:
//
//   --command <cmd>                      a JSON-lines adapter (lib/impl/command.mjs)
//   --decoder <cmd> --dialects <a,b>     a toml-test decoder (lib/impl/decoder.mjs)
//   (neither)                            fig, with --languages <dir> for its
//                                        language modules (lib/impl/fig.mjs)
//
// docs/adapters.md says what each must do.

/** The options every runner takes for choosing the implementation. */
export const IMPL_OPTIONS = {
  command: { type: "string" },
  decoder: { type: "string" },
  dialects: { type: "string" },
  languages: { type: "string" },
};

export async function implFrom(opts, { quiet = false } = {}) {
  if (opts.command && opts.decoder) throw new Error("--command and --decoder name two implementations; pass one");
  if (opts.command) return (await import("./command.mjs")).commandImpl(opts.command);
  if (opts.decoder) {
    if (!opts.dialects) throw new Error("--decoder needs --dialects, the dialects it reads (comma-separated)");
    return (await import("./decoder.mjs")).decoderImpl(opts.decoder, opts.dialects.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return (await import("./fig.mjs")).figImpl({ languages: opts.languages, quiet });
}
