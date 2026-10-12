# figl parse suite

A parse-conformance suite for figl, fig's authoring dialect (`*.figl`, the
format named `fig`). There is no upstream suite for figl, so this one is
written from [fig's specification](https://github.com/diaryx-org/fig/blob/main/docs/spec.md),
version 2.0, and every expectation is derived from the spec's text rather
than recorded from a parser. A case that fails is a disagreement with the
spec, whichever implementation it is run against.

## Shape

- `valid/<area>__<case>.figl` is a document the spec says parses, and
  `valid/<area>__<case>.json` the tree it parses to, in
  [toml-test](https://github.com/toml-lang/toml-test)'s tagged encoding: a
  scalar is `{"type": T, "value": V}` with `V` a string and `T` one of
  `string`, `integer`, `float`, `bool`, `null`, `datetime`,
  `datetime-local`, `date-local`, `time-local`; a mapping is a JSON object
  (key order is the document's), a sequence a JSON array.
- `invalid/<area>__<case>.figl` is a document the spec says must be
  refused. Only the refusal is expected, not its error code.

Each case pins one rule and is named for it. Compare as toml-test does:
integers by value (across radixes, signs and `_`), floats numerically with
NaN equal to NaN, datetimes after normalising the date/time separator, the
case of `T`/`Z`, omitted seconds (`10:30` is `10:30:00`) and trailing
fraction zeros.

Read the files as bytes. Some cases hold a BOM, CRLF, a lone CR, or
invalid UTF-8, and newline translation or a UTF-8 decode would change
what they test.

## What it does not check

- **Number lexemes.** Spec § 2 makes a number's identity its source lexeme
  (`1e2` is not `100.0`, `0xff` is not `0xf_f`). The tagged encoding
  compares by value, so the suite does not hold an implementation to
  lexeme preservation.
- **Enum and char literals** (§ 5.3, `x: enum = atom`, `x: char = 'A'`).
  The tagged encoding has no type for either, so there are no valid cases
  for them; their refusals are covered in `types`.
- **Warnings** (§ 10). A warning leaves the tree well-defined, so a case
  that warns (`007`, `Yes`, `[80, 443] x`, indentation mismatch, a bare
  local time) is a valid case and only its tree is checked.
- **Error codes, comment attachment, and `fig fmt`** (§ 3.4 anchors, § 9).

## Areas

| Area | Spec | Covers |
|---|---|---|
| `document` | § 2, § 3.1 | empty and comment-only documents are an empty mapping; root sequences; marker-only lines are blank; root mixing `=` and `*` |
| `encoding` | § 3.1 | CRLF (including inside multi-line strings), a final CR, BOM, a lone CR as content, CR at a bare value's edge, non-ASCII, invalid UTF-8 |
| `comments` | § 3.4, § 6.3 | `#` after whitespace only; glued `#` is content (URLs, flow tokens); trailing comments after every value form; marked, dangling and end-of-input comments; comments inside flow values and on a flow or multi-line opener; a comment hiding a flow close |
| `markers` | § 3.2 | spaced, contiguous and mixed runs; tabs; shrinking depth; glued `>*`; `>key`, skipped levels, root markers, `*v`; the `-`, `[section]` and `key: value` guardrails |
| `indent` | § 3.3 | indentation is cosmetic: mismatches and tabs warn, never fail |
| `bare` | § 4.1 | whole-token sniffing, interior spaces kept, edges trimmed, `inf`/`nan`/`@x`/`Infinity` as strings, `=`/`:`/`>`/quotes inside a bare value |
| `literals` | § 4.2 | exactly lowercase `true`/`false`/`null`; other spellings are strings |
| `numbers` | § 4.3 | every integer radix, signs (radix included), `_` placement, the leading-zero rule, floats with fraction and/or exponent, and each shape the spec says is a string (`1.`, `.5`, `1_`, `0x_ff`, `1e_5`, …) |
| `datetimes` | § 4.4 | the four kinds, `T`/`t`/space separators, `z`, offsets, fractions, leap days and leap seconds, calendar validation, and malformed shapes that fall back to strings |
| `strings` | § 4.5, § 4.7 | raw and escaped forms, every escape, `\uXXXX`, edge whitespace, quoting overriding sniffing; bad escapes, unclosed strings, raw newlines, trailing content |
| `multiline` | § 4.6 | `'''` verbatim and `"""` smart-dedent, closer indentation, mid-line delimiters, escaped leading `\"""`, empty and blank-line content; opener content, unclosed blocks |
| `committed` | § 4.7 | bracket commitment: markdown links, globs, regexes, `[80, 443] x` as strings; quoted spans skipped; unclosed flow |
| `keys` | § 5.1 | bare-key characters, digit-first keys, quoted keys and segments, spacing around `=`; every character a bare key refuses, empty segments |
| `assign` | § 5.2, § 7.1 | dotted assignments and headers, shared intermediates; missing values, header trailing content, stepping into a scalar |
| `types` | § 5.3 | every annotation, coercions (`09`, `1.`), `inf`/`nan`, `: string` as a raw-text sink; every mismatch the spec names |
| `duplicates` | § 5.4 | re-entering a header is legal; re-defining by assignment, quoting, header, or inside a flow object or element is not |
| `mappings` | § 6.1 | inline `{}`/`[]`/`[{}]`; every way to leave a block container empty |
| `sequences` | § 6.2 | scalar, map and nested `*` elements; the ` = ` check and its exemptions; mixed children and mixed addressing |
| `flow` | § 6.3 | arrays (multi-word values, newlines, trailing commas, bracket-led strings); compact fig objects (whitespace and comma separators, dotted keys, one-token values, the date-time join); JSON objects; every flow error the spec names |
| `closed` | § 6.4 | a flow value refuses extension by dotted path, header, index, or append |
| `sections` | § 7.2 | zero-marker headers re-anchor depth; what does and does not reset a baseline; re-entering a section |
| `append` | § 7.3 | `[]` headers, mid-path `[]` as the last element, nested and marked appends; `xs[] =`, empty targets |
| `index` | § 7.4 | `[i]` assignments and headers; skipped and re-set indexes |
| `plus` | § 8 | `+` re-runs the last zero-marker append; what breaks the chain; marked, glued and dangling `+` |

## Open questions

Places where the spec is silent or ambiguous. None of them has a case;
each says what fig's compiled format and its JS twin both do today.

1. **Radix prefix case.** § 4.3 writes `0x`/`0o`/`0b`; is `0XFF` a number?
   Both read it as a string.
2. **Empty quoted key.** Is `"" = 1` legal? Both accept it.
3. **Whitespace around `.` in a key path** (`a . b = 1`). Both refuse it.
4. **Annotation coercions across kinds.** Is `x: float = 2` a float and
   `x: int = 1e2` a mismatch? Both accept the first (kind not checked here)
   and refuse the second.
5. **Content after a multi-line closer.** § 4.6 says where the block
   closes but not what may follow `'''` on the closer line. Both take a
   comment and refuse anything else.
6. **Datetimes without seconds.** § 4.4 makes seconds optional for a local
   time; § 6.3's join example (`2026-07-01 09:00`) implies a local
   datetime may omit them too, and offset datetimes are unaddressed. Both
   accept `2026-07-01T09:00` and `2026-07-01T09:00Z`.
7. **Surrogate escapes.** Is `"\uD800"` (or a surrogate pair) a bad
   escape? Both refuse both.
8. **`\u0000` and raw control characters** in strings and bare values.
   Both accept them.
9. **Spacing around a type's `:`** (`a:int=1`, `a : int = 1`). § 3.2 allows
   `* : int` for elements only. Both accept both.
10. **`+inf`** under `: float`. § 5.3 lists `inf | -inf | nan`. Both refuse
    it.
11. **Content after a multi-line flow close** (`a = [` ⏎ `1` ⏎ `] x`).
    § 4.7's bracket-commitment rule is per line. Both refuse it.
12. **A marker glued to `#`** (`>#c`). § 3.2 requires a separator before
    the body; § 3.1 calls a marker run followed by `#` a comment line.
    Both accept it.
13. **A marked comment with no parent** (`a = 1` ⏎ `> # c`). Both accept
    it.
14. **`=` inside a fig object's value** (`{a=b=c}`). Both read the string
    `b=c`.
15. **A mid-path index on an empty sequence** (`xs[0][0] = 1`). Both
    create `[[1]]`.
16. **Number range.** § 2 keeps lexemes, so `99999999999999999999` is a
    valid integer and is a case here; nothing says whether `1e400` is a
    float or an error. Both accept it.
