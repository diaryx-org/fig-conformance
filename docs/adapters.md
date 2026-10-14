# Scoring an implementation

The suites score any parser or editor of the languages they cover,
written in any language. The runners never import an implementation; they
reach it through an adapter, in one of three ways:

| Adapter | Flag | What it can run |
|---|---|---|
| A command speaking JSON lines | `--command "<cmd>"` | every check, as far as its methods go |
| A toml-test decoder | `--decoder "<cmd>" --dialects <a,b>` | the parse checks that need only a parse |
| fig, in-process | neither | everything; the default |

```sh
node runner/parse.mjs --command "python3 my_adapter.py"            # every parse suite it has a dialect for
node runner/parse.mjs --command "python3 my_adapter.py" toml yaml  # some suites
node runner/edits.mjs --command "./my-adapter"                     # the edit suites
node runner/parse.mjs --decoder "toml-test-decoder" --dialects toml,toml-1.0 toml
```

Node 24 or later is all the runners need. fig is needed only to score fig,
and to record the edit suites' expectations. A check the implementation
cannot run, for want of a dialect or a method, is reported as not run, and
scores nothing either way.

`examples/` has an adapter of each kind: `python-json/adapter.py` and
`python-json/decoder.py` score Python's `json` module, with nothing but
the standard library, and `fig/serve.mjs` serves fig over the protocol.

## Dialects

A dialect is a name the suites ask for. Each suite asks for its own
(`languages.json`), and some checks ask for another:

| Dialect | Is |
|---|---|
| `json`, `jsonc`, `json5` | JSON (RFC 8259), JSON with comments, JSON5 |
| `yaml`, `yaml-1.1` | YAML 1.2, and YAML 1.1's tag resolution |
| `toml`, `toml-1.0` | TOML 1.1 and 1.0 |
| `zon` | Zig Object Notation |
| `figl` | fig's own language |
| `ini`, `dotenv`, `properties` | INI, `.env`, Java `.properties` |
| `plist` | XML property lists |
| `nestedtext` | NestedText |

An adapter says which it serves. An implementation of one TOML version
serves `toml` or `toml-1.0`, not both, unless it has a switch for each.

## The tree

A parse answers with the document's tree, which every check compares
(`lib/tree.mjs`):

```json
{ "kind": "null" }
{ "kind": "bool",   "value": true }
{ "kind": "int",    "raw": "0x1F" }
{ "kind": "float",  "raw": "1_000.5" }
{ "kind": "string", "value": "…" }
{ "kind": "ext",    "ext": "datetime", "text": "1979-05-27T07:32:00Z" }
{ "kind": "seq",    "items": [ <tree>, … ] }
{ "kind": "map",    "entries": [ [ <key tree>, <value tree> ], … ] }
{ "kind": "alias" }
```

- A number keeps its lexeme as written (`raw`), and the checks read its
  value by the rules the suite names: `0x1F`, `1_000` and `+inf` are
  numbers in TOML.
- A map keeps its entries in document order, duplicates included. Its keys
  are trees, since a YAML key need not be a string.
- `ext` is a scalar that is none of the others: `datetime`,
  `datetime-local`, `date-local` and `time-local` (TOML, YAML 1.1),
  `number-special` (JSON5's `Infinity` and `NaN`), `enum` and `char`
  (ZON's `.name` and `'c'`), `date` and `data` (plist's `<date>` and
  `<data>`).
- `alias` is a YAML alias left unresolved. An implementation may resolve
  it to the tree its anchor names instead.
- An empty document is `{ "kind": "null" }`.

An implementation that writes toml-test's tagged JSON already
(`{"type": "integer", "value": "42"}` leaves, plain objects and arrays) may
send that instead, as `tagged` in place of `tree`.

## The JSON-lines protocol

The runner starts the command once, through the shell, and writes one
request per line to its stdin. The command answers each with one line on
stdout, carrying the request's `id`. Lines end at `"\n"` alone; a JSON
string may hold U+2028 unescaped, and a reader that also splits there
(Node's `readline`) breaks the request in two. Anything on stderr is
passed through to the runner's. A request that is not answered within 60
seconds (`CONFORM_TIMEOUT`) fails the run.

A document is sent as `source`, its text, when it is UTF-8, and as
`source_base64`, its bytes, when it is not: a parser may refuse those
bytes, or read them, as it would a file.

### hello

The first request, before any other.

```json
{"id": 0, "method": "hello", "protocol": 1}
{"id": 0, "name": "mytool 1.2", "dialects": ["toml", "json"], "methods": ["parse", "print"]}
```

`methods` lists what the adapter answers; a check that needs another is not
run. Without `methods`, it is `["parse"]`.

### parse

```json
{"id": 1, "method": "parse", "dialect": "toml", "source": "a = 1\n"}
{"id": 1, "ok": true, "tree": {"kind": "map", "entries": [[{"kind": "string", "value": "a"}, {"kind": "int", "raw": "1"}]]}}
{"id": 1, "ok": false, "error": "line 1: expected a value"}
```

`ok: false` refuses the document. The error is shown with a failing case
and not compared.

### print

Parse the document as `dialect` and write it as `to`: in its own dialect
for the `reprints` check, or as JSON for `converts`.

```json
{"id": 2, "method": "print", "dialect": "yaml", "to": "json", "source": "a: [1, 2]\n"}
{"id": 2, "ok": true, "text": "{\"a\": [1, 2]}"}
```

What is written must parse again as `to`, through the implementation's
own parser when it serves `to`, else as JSON. With an expectation, the
JSON must equal it as values.

### split

Split a stream of documents (YAML's `---`), as byte offsets into the
source's UTF-8.

```json
{"id": 3, "method": "split", "dialect": "yaml", "source": "a: 1\n---\nb: 2\n"}
{"id": 3, "ok": true, "parts": [[0, 5], [9, 14]]}
```

Each part must then parse.

### edit

Apply one edit to the source, and answer with the edited text, or refuse
with a status.

```json
{"id": 4, "method": "edit", "dialect": "toml", "source": "[server]\nport = 80\n", "op": "replaceValue", "args": [["server", "port"], 8080]}
{"id": 4, "ok": true, "source": "[server]\nport = 8080\n"}
{"id": 4, "ok": false, "status": "InvalidArgument"}
```

A path is a list of keys and indices. The ops, with their `args`:

| Op | Args | Does |
|---|---|---|
| `replaceValue` | path, value | replace an existing value |
| `setValue` | path, value | replace, or add the last key if it is missing |
| `insertValue` | path, key, value | add `key` to the mapping at path |
| `renameKey` | path, name | rename the entry's key |
| `deleteKey` | path | delete the entry |
| `appendValue`, `prependValue` | path, value | add an item to the sequence at path |
| `deleteItem` | path, index | delete an item |
| `moveKey` | path, dest path | move the entry to just before the one at dest |
| `reorderKeys` | path, keys | put `keys` first, in order, the rest after as they were |
| `moveItem` | path, from, to | move an item to index `to` |
| `reorderItems` | path, order | item `i` becomes the one that was at `order[i]` |
| `setSequence` | path, items | replace a sequence's items |
| `addLeadingComment` | path, text | add a comment line above the entry or item |
| `setTrailingComment` | path, text | set the comment after it on its line |
| `deleteLeadingComment`, `deleteTrailingComment` | path | remove that comment |
| `addDanglingComment` | path, text | add a comment line inside the container at path, after its entries |
| `deleteDanglingComment` | path | remove those lines |
| `deleteContainer`, `renameContainer` | path (, name) | the same for a table or section and every line that names it |

A value is plain JSON: a string, number, boolean, null, array or object.

The statuses are fig's: `InvalidArgument` (the edit makes no sense here:
no such path, a value the format cannot hold), `NotFound`,
`UnsupportedOperation` (fig has no way to make it), `UnsupportedFormat`
(the format has no comments, say) and `ParseError` (the source does not
parse, or the edit would write a document that does not read back as
asked). A refusal fig makes while opening the source also carries
`"at": "open"`.

## The edit scores

The expectations were recorded from fig (`npm run record:edits`), so the
edit suites score two things:

- **exact**: the same bytes as fig writes, or a refusal with the same
  status. Parity with fig: a second implementation of fig's languages
  wants this.
- **faithful**: the edit did what it asked, read back through the
  implementation's own parser, whatever it wrote; or both refused, with
  any status (`lib/faithful.mjs`). A tool with a style of its own, or
  statuses of its own, is held to this.

Faithful compares trees, so it does not see a comment lost or moved, or
formatting; exact does. It needs `parse` as well as `edit`.

A recorded answer that is not faithful itself, or that changes a value in
a comment edit, is marked `suspect` in the case file. Matching one counts
toward exact, and the runner says how many of a suite's matches are to
one.

## Scores

`--json` prints the scores; `--check <file>` fails if any score in the
file is higher than now. `scores/` holds fig's. An implementation keeps
its own scores file, here or beside its code, and raises it in the change
that earns it.
