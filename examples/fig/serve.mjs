// fig, served over the JSON-lines protocol: the in-process adapter
// (lib/impl/fig.mjs) behind lib/serve.mjs. Scoring it with `--command`
// must give what scoring fig in-process gives, which checks the protocol.
//
//   node --conditions=fig-source runner/edits.mjs \
//     --command "node --conditions=fig-source examples/fig/serve.mjs"
import { figImpl } from "../../lib/impl/fig.mjs";
import { languages } from "../../lib/suites.mjs";
import { serve } from "../../lib/serve.mjs";

const impl = await figImpl({ languages: process.argv[2], quiet: true });
const dialects = [...new Set(languages.flatMap((l) => [l.dialect, "toml-1.0", "yaml-1.1"]))].filter((d) => impl.has(d));
serve({ ...impl, dialects });
