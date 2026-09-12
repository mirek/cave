# @cavelang/canonical

The CAVE semantic layer: verb registry, the §13.4 canonicalization
pipeline, the shared standard prelude, and the canonical emitter. Sits
between `@cavelang/parser` (pure syntax) and `@cavelang/store` (persistence).

```ts
import { canonicalizeText, standardRegistry, emit } from '@cavelang/canonical'
import { Key } from '@cavelang/core'

const result = canonicalizeText('packages/api PART-OF monorepo', standardRegistry)
result.claims[0].claim.verb           // 'CONTAINS' — primary direction
result.claims[0].claim.raw            // 'packages/api PART-OF monorepo' — as written
emit(result)                          // 'monorepo CONTAINS packages/api\n'
```

## Registry (spec §5.5, §5.8)

Inverse pairs are declared in-band — `CONTAINS REVERSE PART-OF` is an
ordinary claim whose subject and object happen to be verbs. The registry is
an immutable value threaded through the pipeline, so a declaration takes
effect for *subsequent* lines only. Rules:

- the **primary** is the left side of the first declaration;
- redeclaring the mirror is a no-op;
- a conflicting declaration is rejected with a problem — first wins;
- no verb is born with an inverse; `standardRegistry` (and the equivalent
  `standardPrelude` CAVE text) carries the eight §5.5 pairs as the "shared
  prelude" the spec allows.

Lifecycle declarations use `OLD RENAMED-TO NEW`. Both same-direction
spellings resolve to the oldest, stable storage verb, while `NEW` is exposed
as preferred and `OLD` as deprecated. This lets later writes use the new name
without rewriting rows or splitting the existing claim key and history.
Linear chains are supported; branches, joins, cycles, and collisions with an
existing verb identity are rejected. Renaming either side of a `REVERSE` pair
preserves direction and makes reverse reads return the preferred opposite name.

## Pipeline (spec §13.4)

`canonicalize(document, registry?)` → `{ claims, edges, registry, problems }`

- **Inverse resolution**: a relational claim with an inverse verb swaps
  subject/object and takes the primary verb *before* keying — a forward
  claim and its inverse reading share one `Key.of` value: one fact, two
  names, one belief series. `raw` keeps the author's text.
- **Continuations** (§8.3): a bare-verb line inherits the parent's subject
  *as written*; if the verb is an inverse, canonicalization then flips it.
  Continuations are independent sibling claims — no edges.
- **Qualifiers** (§8.1–8.2): `WHEN`/`VIA`/`BECAUSE` lines become claim
  nodes joined to the parent by role edges. `UNLESS x` normalizes to
  role `WHEN` + negated condition. Condition shapes:
  - bare entity → `x EXISTS` claim (negated for `NOT x`);
  - comparison → a claim with a canonical verb: `>` → `EXCEEDS`,
    `<` → `IS-BELOW`, `>=` → `IS-AT-LEAST`, `<=` → `IS-AT-MOST`,
    `=` → `EQUALS`, and `!=` → `DIFFERS-FROM`. Numbers, dates and trajectories
    become metrics; text/code literals and ordinary words become relations,
    matching ordinary claim parsing so payload identity survives emission;
  - full claim → canonicalized as usual (inverse resolution applies).
- **Grouped claims** (§8.4): indented full triples stay independent and
  link to their parent with the `QUALIFIES` edge role (§13.2's role list).
- **Recursive prefix shorthand** (§8.5): incomplete headers prefix all
  indented descendants and never materialize claims. Completed leaves retain
  the nearest materialized parent edge, and their stored `raw` text is the
  expanded self-contained claim.
- **Declarations**: `A REVERSE B`, `OLD RENAMED-TO NEW`, and `X IS verb`
  claims update the registry after the line itself is canonicalized.

## Emitter

`emit(result)` produces canonical text — the spec's MUSTs for emitters:

- colon attribute form (`revenue: 20B USD/yr`), even when the input used
  the legacy colonless form (§3.4);
- primary verb direction (§5.5);
- `WHEN NOT x`, never `UNLESS` (§8.2);
- §3.2 anatomy order: payload, `+/- delta`, `(Nσ)`, contexts, tags,
  `@ N%` (omitted at 100%), `!`, `; comment`. A multi-line comment (§6.4)
  opens as full-line `;` comments directly above the claim line, its last
  line riding on the claim, so `emitClaim` may return several lines; a
  §28.4 annotation stays the line directly above the claim.
- recursive factoring of adjacent sibling claims through shared incomplete
  prefixes, stopping before a header would itself parse as a complete claim.

Text round trips apply the parser's comment normalization: CRLF physical line
endings become LF, trailing whitespace on comment lines is removed, and empty
lines at the combined comment's edges are dropped. Interior blank paragraphs
and leading indentation within nonempty comment lines survive. Consequently,
programmatically supplied comments can reparse with different whitespace even
though their claim keys remain the same. Emission does not mutate the supplied
claim. Use exact SQLite snapshots when preserving stored comment bytes matters.

For example, two canonical rows emit tersely without changing their keys:

```cave
foo HAS
  a: A
  b: B
```

The same factoring applies inside qualifier/grouping trees. Transaction
annotations remain directly above each materialized leaf, so annotated export
and sync preserve row identity.

Transaction annotations may carry an optional JSON provenance payload on the
same line. `txOfLine` reads the ID and `txDataOfLine` exposes the payload for
sync validation. `EmitOptions.annotate` preserves it through factoring and
repeated lineage references; ordinary claim parsing ignores the metadata.

Canonical confidence emission preserves the full stored number, including computed
and subnormal values. Percentages use decimal notation without rounding or
exponents; parsing shifts the decimal point before converting to a number.

Emission of a complete canonicalization result is stable:
`emit ∘ canonicalize ∘ emit ≡ emit`, and claim keys survive the round trip
(tested). Comparison rows are valid CAVE both under their qualifier edge and
when emitted in isolation, which keeps storage fallbacks and citations
parseable.

The emitter uses `@claim` when an unmarked full claim would be read as a
qualifier or continuation. `@claim WHEN IS ready` keeps `WHEN` as an entity;
`@claim IS EXISTS` keeps `IS` as an affirmative bare-existence subject. An
explicit qualifier payload such as `WHEN @claim NOT EXISTS` preserves the
entity `NOT` without consuming it as negation. Conditions whose verb is `NOT`
also need the marker: `WHEN @claim item NOT ready`; a negated condition emits
as `WHEN NOT @claim item NOT ready`. A trailing `@claim` remains an
ordinary context, independent of the leading marker. Existing unmarked
continuation and qualifier rules are unchanged.

Sigma overrides emit positive finite plain decimals, including magnitudes for
which JavaScript uses scientific notation. For example, sigma level `1e-7`
emits as `(0.0000001σ)`. Invalid structured sigma levels fail emission.
Uncertainty deltas likewise require a positive finite scalar, including when
emitted directly from structured claims; zero, negative and nonnumeric values
fail before producing CAVE text.

The marker changes no claim fields, keys, edges or metadata. Readers of exports
using it must support explicit claims. `node scripts/reserved-subject-audit.mjs`
checks 510 reserved-name/verb/placement/polarity cases and exits nonzero on any
mismatch in diagnostics, keys or edges. Literal quoting is not used to change
entity kinds as a workaround.

The emission composition regression exercises 4,928 parser-accepted combinations
of subjects, verbs, payload forms and metadata. It compares every semantic claim
field (including confidence, uncertainty and comments), graph edges and second-
emission text stability. Raw source spelling and line locations intentionally
change during canonicalization. This finite corpus complements the reserved-name
and malformed structured-input checks; it is not an exhaustive grammar proof.

### Structured claim validation

`emitClaim` and `emit` reject these programmatically constructed fields with a
`TypeError` before returning canonical text:

| Field | Rejected input | Supported representation |
|---|---|---|
| Context and tag collections | Non-arrays, including strings, sets and array-like objects | Supply arrays; `Claim.of` defaults omitted collections to empty arrays. |
| Term text and value raw text | Non-strings, including arrays and boxed strings | Supply primitive strings; emission does not coerce data into literal text. |
| Term and payload kinds | Missing or unsupported kind names | Terms use `entity`, `text` or `code`; payloads use `relation`, `attribute`, `metric` or `none`. Unknown kinds are rejected rather than emitted as an entity or dropped. |
| Negation and importance | Any non-boolean, including missing fields, `null`, numbers and strings | Supply `true` or `false`; `Claim.of` provides defaults. This also applies to qualifier claims. |
| Subject, verb, payload or metadata | Embedded LF newline | Put multiline commentary in the claim's comment. |
| Text or code literal | Its own closing delimiter: a double quote in text, or a backtick in code | The other delimiter remains ordinary content. |
| Rendered claim body | An unquoted comment start or unmatched literal delimiter | Keep comment text in the comment field and delimit literal content completely. |
| Entity relation object | Text that reparses as a metric, attribute, literal, negation or metadata, or has no object | Use the appropriate payload kind or an explicit text/code literal. Ordinary object phrases retain whitespace normalization. |
| Value fields, including uncertainty deltas | Kind, numeric fields, units or approximation flags that disagree with raw text | Construct values with `Value.parse`, `Value.ofText` or `Value.ofCode`. |
| Unquoted value text | Empty text, metadata tokens, literal syntax mislabeled as unquoted, or whitespace that tokenization changes | Use canonical single spaces between words; use text/code literals for exact whitespace or metadata-looking content. |
| Metric payload | An atom, text or code value | Metrics use numbers, dates or trajectories; use relations or attributes for other values. |
| Empty payload | A verb other than `EXISTS` | Supply an object/value, or use `EXISTS` for bare existence. |
| Attribute name | Empty text, token splits, literal syntax or a metadata prefix | One non-metadata word followed by the emitted colon; embedded colons and Unicode remain supported. |
| Context or tag | Empty metadata tokens, whitespace/comment splits, or a tag key that reparses as a key/value pair | Contexts retain their complete token; colons in scoped tag values remain supported. |
| Verb | Anything other than an uppercase atom | Uppercase letters and hyphens, starting with a letter; extension verbs and trailing hyphens are accepted. |
| Entity subject | Empty text, multiple tokens, a comment start, metadata, or literal syntax mislabeled as an entity | Use a text or code term when the subject needs literal syntax. |

These checks also apply to abbreviated existence qualifiers such as `WHEN
subject`, their metadata, and their negated forms. Multiline comments retain
their separate comment lines. Object phrases retain the existing parsing and
canonical normalization rules.
Bare carriage returns inside text and code literal values remain literal content:
emission and parsing preserve their exact value and claim key. Embedded LF,
including the LF in CRLF, remains rejected in structured claim fields.

For graph input, `emit` requires every edge's `parent` and `child` to be
non-negative safe integer indices within the claims array, and its `role` to be
`WHEN`, `VIA`, `BECAUSE` or `QUALIFIES`. It captures those fields once and validates
all edges before rendering or invoking annotation callbacks. Invalid edges throw
`TypeError` instead of silently disappearing or becoming ordinary claim text.
Shared premises and cycles retain their existing re-statement behavior.
The claims collection must be a dense array with an own entry at every index.
Sparse arrays throw `TypeError` before annotation callbacks run instead of
silently omitting their holes. Rejection leaves the supplied array unchanged;
passing a corrected dense collection permits a fresh emission.

`EmitOptions.annotate` runs in depth-first appearance order, including each
re-statement of a shared or cyclic claim. The same claim index can therefore
reach the callback more than once. For replayable text, derive the annotation
from a stable transaction ID associated with that index; generating a new ID on
every callback invocation would give one graph claim several identities.
The returned string is emitted verbatim. Return `undefined` for appearances
that need no annotation; the emitter does not validate transaction IDs or
annotation payloads on the callback's behalf.
If an annotation callback throws, emission propagates that error and stops
invoking callbacks. A fresh call starts traversal again; the emitter does not
retain partial graph state or undo side effects performed by the callback.

Graph expansion and text rendering use explicit traversal stacks, so deep
qualifier chains do not consume one JavaScript call frame per level. A
3,000-claim support chain closing into a cycle is covered by a regression that
checks every emitted line and annotation visit in order. This removes the
recursive call-stack limit; it does not cap graph size or output memory.
Indentation still grows with depth, so a long single chain produces text whose
size grows quadratically with the number of claims.
Sibling-prefix checks, metadata appends and multiline-comment rendering also
avoid spreading unbounded arrays into function arguments. Regressions cover
130,000 sibling claims and a 130,000-line comment. The renderer retains each
sibling group's end and skips prefix factoring for one-token leaves, avoiding
repeated scans and copies of those remaining siblings. These checks establish
specific workloads, not a general output-size or processing-time limit.
The deep-cycle and broad-sibling regressions also canonicalize the emitted text
without diagnostics, check the resulting claim and edge counts, and verify that
re-emission is byte-for-byte stable. Plain text represents a cycle's closing
reference as a repeated claim; transaction annotations supply identity when
replay must reconstruct shared graph rows.
The 130,000-line comment fixture also parses back into one claim with its entire
comment unchanged and re-emits identically, including the final inline comment
line. This checks both comment rendering and reconstruction at that size.
The renderer also checks once per sibling group whether its shared first token
already completes a claim. If so, no suffix can use it as a factored header;
the remaining siblings render directly. This avoids repeated suffix scans for
groups such as `EXISTS @ 70%` beneath an inherited subject prefix, while retaining
confidence metadata and allowing later groups to factor normally.

CAVE has no literal escape syntax. Emission does not rewrite the supplied claim
or change its literal kind to make invalid content fit. These checks cover the
listed boundaries; they do not establish that every malformed programmatic
claim is validated. The store applies them during
[structured appends](../store/README.md#structured-appends), including when raw
text is supplied. Historical rows remain unchanged. In particular, previously
stored metrics containing atom/text/code values now fail emission instead of
silently changing payload identity; this validation does not migrate them.

`canonicalize` and `canonicalizeText` run the same validation before accepting
claims. Rejected lines produce diagnostics and do not add claims, edges or
registry declarations. This includes unterminated delimiters that the tolerant
tokenizer represents as words. Descendant continuations and qualifiers report
a missing canonicalized parent when their parent was rejected. Grouped full
claims remain independent (§8.4): they survive a rejected parent, with a
diagnostic for the missing grouping edge, and retain their own descendants and
declarations. Store ingestion
keeps valid lines in lenient mode; strict mode rejects the whole input.

Unquoted relation objects are checked against the parser's payload classification
before emission. ASCII names starting with a letter or underscore, followed by letters, digits,
underscores, dots, slashes or hyphens, use a lexical fast path except for `NOT`; other objects use the parser and retain the existing entity
whitespace normalization. This check does not convert a relation into a metric,
attribute or literal on the caller's behalf.

### Emission cost

Fully uppercase entity subjects also run document classification to determine
whether `@claim` is needed. The subject/object benchmarks below do not measure
that path.

Common ASCII entity subjects use a fast lexical check; other subjects retain
the parser-based validation. Both paths reject the same malformed boundaries.
The ASCII check requires the actual end of input, so a terminal line break
cannot pass as an ordinary name. Character-boundary tests compare emission
with the parser's decisions across ASCII controls, punctuation and Unicode.

Run `node scripts/subject-emission-bench.mjs` from the repository root to measure
20,000 independent claim emissions per family. Fixture creation and output
checks are untimed; two warmup passes precede seven measured passes. On the
review machine, medians before and after the ASCII fast path were:

| Node | ASCII subjects | Unicode subjects | Literal subjects |
|---|---:|---:|---:|
| 24.16.0 | 33.046 → 3.410 ms | 32.760 → 33.310 ms | 2.747 → 2.852 ms |
| 26.5.0 | 30.807 → 3.341 ms | 34.530 → 33.801 ms | 2.442 → 2.490 ms |

These are local emitter measurements, not end-to-end store or export timings.
Unicode subjects retain the full parser path; no general speedup is claimed.

After adding comment-boundary validation, the same benchmark measured:

| Node | ASCII subjects | Unicode subjects | Literal subjects |
|---|---:|---:|---:|
| 24.16.0 | 4.565 ms | 36.289 ms | 6.771 ms |
| 26.5.0 | 4.350 ms | 35.791 ms | 6.188 ms |

Bodies containing quotes, backticks or semicolons now also run the comment
splitter to verify that a following comment remains outside the claim body.
The simple ASCII case avoids that scan. These measurements include the added
validation and retain the same benchmark limits above.


With relation identity validation, the same benchmark measured:

| Runtime | ASCII subjects | Unicode subjects | Literal subjects |
|---|---:|---:|---:|
| Node 24.16.0 | 4.792 ms | 34.414 ms | 6.979 ms |
| Node 26.5.0 | 4.772 ms | 37.184 ms | 6.767 ms |

All three families use the alphabetic object `retained`, exercising the object
fast path. These numbers do not measure the parser fallback for other objects.
The initial version parsed every entity relation and measured 51.512/46.762 ms
for the ASCII family on Node 24/26, motivating the narrow lexical fast path.

Object-shape costs can be reproduced with `node scripts/object-emission-bench.mjs`.
This uses 20,000 claims per shape, two warmups and seven measured passes; fixture
creation, full output checks and representative semantic round trips are untimed.
Expanding the object fast path to letter/underscore-led names with digits, dots,
slashes and hyphens measured the following local medians:

| Object shape | Node 24 before | Node 24 after | Node 26 before | Node 26 after |
|---|---:|---:|---:|---:|
| Alphabetic | 4.489 ms | 4.485 ms | 4.597 ms | 4.249 ms |
| Hyphenated with digits | 60.024 ms | 4.714 ms | 52.084 ms | 4.507 ms |
| Scoped path | 58.492 ms | 4.065 ms | 56.606 ms | 3.710 ms |
| Object phrase | 90.963 ms | 88.563 ms | 81.158 ms | 79.319 ms |
| Unicode name | 57.232 ms | 56.716 ms | 55.710 ms | 56.462 ms |
| Text literal | 7.214 ms | 7.360 ms | 8.213 ms | 6.586 ms |
| Code literal | 6.569 ms | 6.886 ms | 6.079 ms | 6.204 ms |

These Node 24.16.0/26.5.0 measurements isolate emission on this machine, not
end-to-end ingestion. Phrases and Unicode names still use the parser fallback;
small differences in unchanged paths are measurement variation. The parser
comparison test covers accepted names and adjacent reserved syntax across three
verbs. `NOT`, numeric/date prefixes, colons, whitespace and metadata remain
outside the fast path.

## Design decisions

- **"As written" inheritance**: a continuation under an inverse-form parent
  (`packages/api PART-OF monorepo` + `  CONTAINS x`) inherits the parent's
  *written* subject (`packages/api`), matching §8.3's mechanical rule, then
  canonicalizes independently — including in-band declarations, which work
  from continuations exactly as from full lines (§5.4).
- **The inverse swap re-classifies endpoints symmetrically**: a date/number
  endpoint is a metric payload in one direction and a subject term in the
  other, so `deploy PRECEDES 2026-01-01` and `2026-01-01 FOLLOWS deploy`
  land on one claim key. Qualifier negation always emits as the `WHEN NOT …`
  prefix; an affirmative entity named `NOT` or a condition with verb `NOT` uses
  an explicit claim marker.
  A claim-internal `VERB NOT` after a symbolic comparison operator
  would invert the condition on reparse.
- **Undeclared inverse continuations** (§8.3 calls them ill-formed) cannot
  be *detected* — `PART-OF` without a declaration is just an unknown verb,
  so the line canonicalizes forward with the inherited subject. Loading the
  standard prelude first gives the intended reading.
- **Comparison compatibility**: symbolic operators remain accepted in authored
  `WHEN`/`UNLESS` input, and `>` retains its existing stored `EXCEEDS` verb.
  The other five operators now store and emit the canonical verbs listed
  above. Consumers that inspect condition-row verbs should accept those names;
  operator input and CAVE-Q `WHERE value <op> ...` filters are unchanged.
- **Three-way negation XOR** for qualifier conditions: inner `NOT`,
  qualifier-level `NOT`, and `UNLESS` each flip the condition's negation.
- **Comments do not fan out from headers**: a prefix header comment is
  documentary only. Persisted comments stay on leaf claims, preventing one
  comment from silently becoming metadata on several rows. A leaf's
  multi-line comment block is emitted at the leaf's indentation.

## Tests

```
pnpm --filter @cavelang/canonical test
```

Covers the §5.5 inverse semantics (shared keys, negation riding the row,
belief series through either name), §8.3 continuation table, §8.2
equivalent forms, the §21 worked example including its inverse reads, and
emitter round-trip stability, plus §5.8 rename chains, deprecation,
collision handling, stable history, and inverse composition.
