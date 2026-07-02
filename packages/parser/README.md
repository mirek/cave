# @cave/parser

CAVE text → AST. Implements the syntax layer of the
[CAVE v3 specification](../../README.md): lexical rules (§4), line shapes
(§3), indentation kinds (§8) and the normative grammar (§16). Built on
[`@prelude/parser`](https://www.npmjs.com/package/@prelude/parser)
combinators.

The parser is deliberately *pre-semantic*: inverse verbs stay as written
(`packages/api PART-OF monorepo` keeps verb `PART-OF`), continuation lines
keep their missing endpoint, `UNLESS` stays `UNLESS`. The §13.4
canonicalization pipeline lives in `@cave/canonical`.

```ts
import { parseDocument, parse } from '@cave/parser'

const doc = parseDocument(`
server CAUSE crash @ 80%
  WHEN load > ~1000 req/s
  WHEN NOT cache/enabled
`)
doc.lines        // classified lines with depth + parent links
doc.diagnostics  // never throws — problems are collected

parse('a USES b')  // strict variant: throws on any diagnostic
```

## Pipeline

1. **Split physical lines**, measure indentation (`document.ts`).
2. **Split off the comment** at the first `;` outside quotes/backticks
   (`Token.splitComment`).
3. **Tokenize** into words / `"text"` literals / `` `code` `` literals
   (`token.ts`, `@prelude/parser` combinators).
4. **Classify** the line per §8's three-kind table: qualifier (starts with
   `WHEN`/`UNLESS`/`VIA`/`BECAUSE`), continuation (starts with a bare
   relational verb), or full claim.
5. **Parse the token stream** (`line.ts`): subject, verb, `NOT`, payload,
   then metadata items.
6. **Resolve parents**: each structural line links to the nearest
   less-indented structural line above.

## Payload classification

| Shape | Result |
|---|---|
| `attr: value` | attribute payload (any verb — §21 uses `NEEDS test: …`) |
| `HAS attr value` (colonless, value numeric/date) | attribute payload + legacy diagnostic (§3.4) |
| numeric/date value (any verb) | metric payload — `latency IS 30ms`, `load EXCEEDS 1000 req/s` |
| nothing (verb `EXISTS`) | `none` payload (§5.2 bare existence) |
| single term | relational object |
| words only | relational object phrase (entity whitespace normalized later) |

The payload/metadata boundary is lexical: a metadata item is unambiguous at
its first token (`@ctx`, `@` + spaced percentage, `#tag`, `+/-`, `(Nσ)`,
`!`), so payload is everything before the first one (§4.3).

## Qualifier payloads

`qualifier_payload` is loose in the grammar; three shapes cover the spec's
examples and are tried in order:

1. full claim — `WHEN memory-leak EXISTS @ 60%` (§10.2)
2. comparison — `WHEN load > ~1000 req/s`; ops `>` `<` `>=` `<=` `=` `!=`
3. bare entity — `WHEN cache-miss`, `WHEN NOT cache/enabled`

## Design decisions

- **Never throw, always classify.** `parseDocument` returns an entry for
  *every* physical line; broken ones become `invalid` with a diagnostic.
  This honors the robust-extraction goal (§1.6) and makes the parser usable
  as a linter.
- **Classification tiebreak.** A line starting with a verb-shaped token is a
  continuation *unless* the second token is also verb-shaped (and not
  `NOT`), in which case it is a full triple with an uppercase subject. This
  resolves `API NEEDS auth` (claim) vs `CONTAINS packages/web`
  (continuation) vs `CONTAINS REVERSE PART-OF` (claim) without a registry.
- **`@` disambiguation is exactly one character of lookahead** (§6.3):
  the token `@` alone expects a following percentage (confidence);
  `@anything` is a context.
- **No escape sequences in literals** — the spec defines none. A quoted
  literal runs to the next matching delimiter; an unterminated one degrades
  to a plain word.
- **Metadata problems don't kill lines.** `a USES b stray` parses with a
  diagnostic; only structural failures (missing verb/object) invalidate a
  line.

## Tests

```
pnpm --filter @cave/parser test
```

Every syntax example from spec §3–§8, §16 and the §21 worked example is a
test case.
