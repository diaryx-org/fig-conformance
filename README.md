# fig-conformance

Conformance suites for the languages fig reads and edits. A suite scores a
language by name, through fig's language contract, and never imports an
implementation, so the compiled Zig formats, the JS languages in
`@diaryx/fig`, and a Lua or Rust helper are all held to the same cases.
[fig's proposal](https://github.com/diaryx-org/fig/blob/main/docs/proposals/conformance-suite.md)
says why.

Only the edit suites are here so far. The parse suites (yaml-test-suite,
toml-test and the rest) are still in fig's `testdata/`.

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

## Licence

MIT or Apache-2.0, at your option. The sources came from fig's own test
fixtures.
