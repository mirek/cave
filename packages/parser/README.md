# @cavelang/parser

CAVE text → AST. Implements the syntax layer of the
[CAVE specification](../../README.md#the-specification): lexical rules (§4), line shapes
(§3), indentation kinds (§8) and the normative grammar (§16). Built on
[`@prelude/parser`](https://www.npmjs.com/package/@prelude/parser)
combinators.

The parser is deliberately *pre-semantic*: inverse verbs stay as written
(`packages/api PART-OF monorepo` keeps verb `PART-OF`), continuation lines
keep their missing endpoint, `UNLESS` stays `UNLESS`. The §13.4
canonicalization pipeline lives in `@cavelang/canonical`.

```ts
import { parseDocument, parse } from '@cavelang/parser'

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
- **Classification tiebreak.** A line starting with a verb-shaped token is
  classified using the known standard vocabulary (standard verbs, `HAS`,
  `REVERSE`, the §5.5 inverse names). A two-token `VERB VERB` line is a
  continuation because it has no full-claim payload. Otherwise, second token `REVERSE` → claim
  (declaration); second token a *known* verb → claim with an uppercase
  subject (`API NEEDS auth`); first token known → continuation, even when
  the object is ALL-CAPS (`USES JWT`, `PART-OF ORG`, `USES GPU cluster`);
  neither known → claim (`API MIGRATES postgres`). The residual ambiguity —
  an *extension*-verb continuation with an ALL-CAPS object — is inherently
  registry-dependent and the parser stays registry-free; write the subject
  explicitly there.
- **Verb boundary.** Following §16's `uppercase_atom`, verb tokens start with
  an uppercase letter and may continue with uppercase letters or `-`, including
  a trailing hyphen. Both parsers therefore classify `USES-` as a verb.
- **`@` disambiguation is exactly one character of lookahead** (§6.3):
  the token `@` alone expects a following percentage (confidence);
  `@anything` is a context.
- **No escape sequences in literals** — the spec defines none. A quoted
  literal runs to the next matching delimiter; an unterminated one degrades
  to a plain word.
- **Metadata problems don't kill lines.** `a USES b @production stray-token`
  parses the claim with a diagnostic for text after metadata; multiword
  relation objects such as `a USES b stray` are valid. Only structural
  failures (missing verb/object) invalidate a line. Confidence must end in `%`
  and stay ≤ 100 (`@ 2026`, `@ 90`,
  `@ 250%` are diagnosed rather than silently clamped); repeating a
  non-repeatable metadata item (`@ N%`, `+/-`, `(Nσ)`, `!`) is diagnosed
  with last-wins retention (§3.2 allows repetition only for contexts and
  tags); a glued attribute colon (`expiry:3600s`) splits into the attribute
  form with a diagnostic, since payload `:` is reserved (§4.3).

## Tests

```
pnpm --filter @cavelang/parser test
```

Every syntax example from spec §3–§8, §16 and the §21 worked example is a
test case.
