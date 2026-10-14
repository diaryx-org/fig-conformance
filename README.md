# fig-conformance

Conformance suites for configuration languages: JSON, JSONC, JSON5, YAML,
TOML, ZON, INI, dotenv, `.properties`, plist, NestedText and figl. They
score any parser or editor, written in any language. The runners never
import an implementation; they reach it through an adapter: a command
that speaks JSON lines, any toml-test decoder, or fig in-process
([docs/adapters.md](docs/adapters.md)).

```sh
node runner/parse.mjs --command "python3 examples/python-json/adapter.py" json
node runner/parse.mjs --decoder "my-toml-test-decoder" --dialects toml toml
node runner/edits.mjs --command "./my-editor-adapter" toml yaml
```

There are two tiers: parse suites, which ask whether an implementation
reads a document as its spec says, and edit suites, which ask what an edit
makes of it. The suites began as fig's
([fig's proposal](https://github.com/diaryx-org/fig/blob/main/docs/proposals/conformance-suite.md)
says why), and fig is still their reference: the edit expectations are
fig's answers, and a few parse cases a spec leaves to the implementation
expect fig's choice.

## Parse suites

`suites/<suite>/parse/` holds `suite.json`, the corpora it names, and the
upstream's licence:

| Suite | Corpus | From |
|---|---|---|
| json | accept, reject, edgecase | JSONTestSuite |
| json5 | cases (outcome by extension) | json5-tests |
| yaml | accept (with upstream's expected JSON), reject, stream, reject-stream | yaml-test-suite, `data` branch |
| yaml | 1.1 (tagged JSON) | fig's own, hand-written |
| toml | 1.0.0, 1.1.0 (valid with tagged JSON, invalid) | toml-test |
| figl | valid (tagged JSON), invalid | written from fig's spec |
| plist | valid (with `plutil`'s JSON), invalid | fig's own |
| nestedtext | valid (with `load_out`), invalid | nestedtext_tests |

A manifest names the dialect and lists checks, each a kind over a corpus:

```json
{ "name": "expect", "kind": "converts", "corpus": "accept", "ext": "yaml", "to": "json", "expect": "json" }
```

The kinds are `parses`, `refuses`, `reprints`, `converts`, `agrees`,
`stream` and `refuses-stream`, and the expectations `tagged` (toml-test's
`{"type", "value"}`), `plain` and `json`; `lib/parse.mjs` says what each
asks. A check may name another dialect (`toml-1.0`, `yaml-1.1`); an
implementation without it, like one without a stream splitter, reports the
check as not run instead of scoring it. Cases whose bytes are not UTF-8
are marked in the manifest as outside the contract, since the wire carries
text, and are tallied apart.

Each upstream has a script in `scripts/` that fetches it at a pinned
commit and writes the corpus, without parsing anything with fig (or any
other implementation):
`vendor-json.mjs`, `vendor-json5.mjs`, `vendor-yaml.mjs`, `vendor-toml.mjs`,
`vendor-nestedtext.mjs`, and `plist-oracles.mjs`, which asks `plutil` for
the plist oracles. Pass a checkout to use it instead of cloning.

```sh
node runner/parse.mjs --command "<cmd>"   # any implementation (docs/adapters.md); needs no fig
npm run parse                       # the JS languages (@diaryx/fig/js/*), registered into a language-free fig
npm run parse:native -- --check scores/compiled.json  # fig's Zig, a wasm module per language (@diaryx/fig-<name>, in ../fig/languages)
npm run parse -- yaml toml          # some suites
npm run parse -- --languages dir    # your own language modules, <dir>/<name>.js
npm run parse -- --failures f.json  # every failing case, and why
npm run parse -- --json             # the scores, as scores/*.json holds them
npm run parse -- --check scores/js.json
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm npm run parse:compiled -- --check scores/compiled.json
```

`scores/compiled.json` and `scores/js.json` are fig's implementations'
scores today. `--check` fails if any is now lower; raising one is an edit
to the file in the change that earns it.

## Edit suites

`suites/<language>/edits/` holds `sources/`, the documents, and one case
file per source. A case is one edit op (docs/adapters.md lists them, as
fig's `Editor` names them) applied to the source as written:

```json
{"id": "server.port: replace with int", "op": "replaceValue", "args": [["server", "port"], 42],
 "expect": {"ok": true, "splice": [15, 19, "42"]}}
```

A successful edit is expected as the splice that makes the edited document
from the source: its UTF-8 bytes from `start` to `end` replaced by `text`.
A refusal is expected as `{ "ok": false, "status": "InvalidArgument" }`.
The status is compared and the message is not: statuses belong to the
contract, messages to the implementation.

The cases are generated from each source's tree (`lib/edits.mjs`). Every
entry is renamed, deleted, replaced by a scalar of each kind and by each
kind of container, and given or relieved of each kind of comment. Every
mapping has values inserted, keys reordered and moved, and is deleted or
renamed as a whole container. Every sequence has items appended,
prepended, deleted, moved and reordered. A new source brings its cases
with it.

The expectations are what fig's compiled formats answer. That makes the
`exact` score a parity check with fig, and a fault both sides share passes
it. So each suite has a second score, `faithful`, that needs no reference:
the edit, read back through the implementation's own parser, made exactly
the asked-for change and nothing else, or both refused
(`lib/faithful.mjs`). A tool that writes in its own style can reach it.

The recorder holds fig to the same: a recorded answer that is not
faithful, or whose comment edit changes a value, is marked `suspect`, and
the runner says how many of its matches are to one.

## Running

Node 24 or later. To score fig, or to record, a fig checkout beside this
one (or `FIG_PACKAGE` pointing at its `bindings/typescript`).

```sh
node runner/edits.mjs --command "<cmd>"  # any implementation with an edit method (docs/adapters.md)
npm run edits                      # every suite, against @diaryx/fig's JavaScript languages (js/)
npm run edits:native               # against its native ones: fig's Zig, a wasm module per language
npm run edits -- yaml toml         # some suites
npm run edits -- --languages dir   # your own language modules, <dir>/<name>.js
npm run edits -- --failures f.json # every case not exact: expected, got, and why it is not faithful
npm run edits -- --exact-only      # skip the faithful score
```

`languages.json` maps a suite to its dialect, its file extension, what
its values can hold for the faithful score (`scalars`, `empty`), and the
fig language module that serves it.

## Recording

Recording needs a fig wasm module with every format compiled in:

```sh
(cd ../fig && zig build wasm -Djson=true -Dyaml=true -Dtoml=true -Dzon=true -Dfigl=true \
  -Dini=true -Ddotenv=true -Dproperties=true -Dplist=true -Dnestedtext=true --prefix /tmp/fig-ref)
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm npm run record:edits [suite…]
```

Record again when a compiled editor changes, and read the diff: an
expectation that moves is a change every implementation must follow.

## Scoring fig's own languages

fig 6.0 compiles no language into core: its Zig languages register through
the contract like any other. A fig wasm built with them (`-D<name>=true`)
has them registered under their own names, so the runners score them with
no prefix, and the edit runner registers nothing for a dialect the module
already has:

```sh
(cd ../fig && zig build wasm -Djson=true -Dyaml=true -Dtoml=true -Dzon=true -Dfigl=true \
  -Dini=true -Ddotenv=true -Dproperties=true -Dplist=true -Dnestedtext=true --prefix /tmp/fig-ref)
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm npm run parse:compiled -- --check scores/compiled.json
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm node --conditions=fig-source --import ./lib/reference-wasm.mjs runner/edits.mjs
```

`FIG_DIALECT_PREFIX` still prefixes every dialect name the runners ask for,
for a module that registers its languages under prefixed names.

## Licence

MIT or Apache-2.0, at your option. The edit sources, and the plist and
YAML 1.1 parse corpora, came from fig's own test fixtures. Each corpus
vendored from an upstream is under that upstream's licence, which sits
beside it.
