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

## Registry (spec §5.5)

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
  - comparison → `left EXCEEDS value` (metric payload); `>`→`EXCEEDS`,
    other operators keep their symbol as the verb;
  - full claim → canonicalized as usual (inverse resolution applies).
- **Grouped claims** (§8.4): indented full triples stay independent and
  link to their parent with the `QUALIFIES` edge role (§13.2's role list).
- **Declarations**: `A REVERSE B` and `X IS verb` claims update the
  registry after the line itself is canonicalized.

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
(tested). Symbolic comparison rows are valid only as attached qualifier
conditions; callers emitting an isolated child row must retain that context
until the canonical comparison-verb work tracked in the backlog is complete.

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
- **Comparison verbs**: only `>` has a standard verb (`EXCEEDS`); `<`,
  `>=`, `<=`, `=`, `!=` keep their symbol as the stored verb. They appear
  only as condition claims.
- **Three-way negation XOR** for qualifier conditions: inner `NOT`,
  qualifier-level `NOT`, and `UNLESS` each flip the condition's negation.

## Tests

```
pnpm --filter @cavelang/canonical test
```

Covers the §5.5 inverse semantics (shared keys, negation riding the row,
belief series through either name), §8.3 continuation table, §8.2
equivalent forms, the §21 worked example including its inverse reads, and
emitter round-trip stability.
