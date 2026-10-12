# fig-conformance

Conformance suites for the languages fig reads and edits. A suite scores a
language by name, through fig's language contract, and never imports an
implementation, so the compiled Zig formats, the JS languages in
`@diaryx/fig`, and a Lua or Rust helper are all held to the same cases.
[fig's proposal](https://github.com/diaryx-org/fig/blob/main/docs/proposals/conformance-suite.md)
says why.

There are two tiers: parse suites, which ask whether a language reads a
document as its spec says, and edit suites, which ask what an edit makes of
it.

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
commit and writes the corpus, without parsing anything with fig:
`vendor-json.mjs`, `vendor-json5.mjs`, `vendor-yaml.mjs`, `vendor-toml.mjs`,
`vendor-nestedtext.mjs`, and `plist-oracles.mjs`, which asks `plutil` for
the plist oracles. Pass a checkout to use it instead of cloning.

```sh
npm run parse                       # the JS languages, registered into a language-free fig
npm run parse -- yaml toml          # some suites
npm run parse -- --languages dir    # your own language modules, <dir>/<name>.js
npm run parse -- --failures f.json  # every failing case, and why
npm run parse -- --json             # the scores, as scores/*.json holds them
npm run parse -- --check scores/js.json
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm npm run parse:compiled -- --check scores/compiled.json
```

`scores/compiled.json` and `scores/js.json` are each implementation's
scores today. `--check` fails if any is now lower; raising one is an edit
to the file in the change that earns it.

## Edit suites

`suites/<language>/edits/` holds `sources/`, the documents, and one case
file per source. A case is one `Editor` method applied to the source as
written:

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
suite a parity check, and a fault both sides share passes it. So the
recorder also checks one thing that needs no reference: a comment edit
changes no value. A recorded answer that breaks it is marked `suspect`,
and the runner says how many of its matches are to one.

## Running

Node 24 or later, and a fig checkout beside this one (or `FIG_PACKAGE`
pointing at its `bindings/typescript`).

```sh
npm run edits                      # every suite, against @diaryx/fig's languages
npm run edits -- yaml toml         # some suites
npm run edits -- --languages dir   # your own language modules, <dir>/<name>.js
npm run edits -- --failures f.json # every mismatch, expected and got
```

`languages.json` maps a suite to its dialect, the language module that
serves it, and its file extension.

## Recording

Recording needs a fig wasm module with every format compiled in:

```sh
(cd ../fig && zig build wasm -Djson=true -Dyaml=true -Dtoml=true -Dzon=true -Dfig=true \
  -Dini=true -Ddotenv=true -Dproperties=true -Dplist=true -Dnestedtext=true --prefix /tmp/fig-ref)
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm npm run record:edits [suite…]
```

Record again when a compiled editor changes, and read the diff: an
expectation that moves is a change every implementation must follow.

## Scoring the contract path

A fig wasm built with `-Dcontract-copies=true` registers each compiled
language a second time through its contract vtable, as `c-<name>`, the
first time a `c-` name is looked up. `FIG_DIALECT_PREFIX=c-` makes the
runners score those copies instead of the compiled formats, with nothing
registered from JavaScript:

```sh
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm FIG_DIALECT_PREFIX=c- npm run parse:compiled -- --check scores/compiled.json
FIG_REFERENCE_WASM=/tmp/fig-ref/bin/fig.wasm FIG_DIALECT_PREFIX=c- node --conditions=fig-source --import ./lib/reference-wasm.mjs runner/edits.mjs
```

It is how a Zig language is shown to lose nothing by reaching fig through
the contract alone.

## Licence

MIT or Apache-2.0, at your option. The edit sources, and the plist and
YAML 1.1 parse corpora, came from fig's own test fixtures. Each corpus
vendored from an upstream is under that upstream's licence, which sits
beside it.
