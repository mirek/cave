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
  - comparison → a metric claim with a canonical verb: `>` → `EXCEEDS`,
    `<` → `IS-BELOW`, `>=` → `IS-AT-LEAST`, `<=` → `IS-AT-MOST`,
    `=` → `EQUALS`, and `!=` → `DIFFERS-FROM`;
  - full claim → canonicalized as usual (inverse resolution applies).
- **Grouped claims** (§8.4): indented full triples stay independent and
  link to their parent with the `QUALIFIES` edge role (§13.2's role list).
- **Declarations**: `A REVERSE B`, `OLD RENAMED-TO NEW`, and `X IS verb`
  claims update the registry after the line itself is canonicalized.

## Emitter

`emit(result)` produces canonical text — the spec's MUSTs for emitters:

- colon attribute form (`revenue: 20B USD/yr`), even when the input used
  the legacy colonless form (§3.4);
- primary verb direction (§5.5);
- `WHEN NOT x`, never `UNLESS` (§8.2);
- §3.2 anatomy order: payload, `+/- delta`, `(Nσ)`, contexts, tags,
  `@ N%` (omitted at 100%), `!`, `; comment`.

Emission of a complete canonicalization result is stable:
`emit ∘ canonicalize ∘ emit ≡ emit`, and claim keys survive the round trip
(tested). Comparison rows are valid CAVE both under their qualifier edge and
when emitted in isolation, which keeps storage fallbacks and citations
parseable.

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
  prefix — a claim-internal `VERB NOT` after a symbolic comparison operator
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

## Tests

```
pnpm --filter @cavelang/canonical test
```

Covers the §5.5 inverse semantics (shared keys, negation riding the row,
belief series through either name), §8.3 continuation table, §8.2
equivalent forms, the §21 worked example including its inverse reads, and
emitter round-trip stability, plus §5.8 rename chains, deprecation,
collision handling, stable history, and inverse composition.
