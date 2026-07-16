# @cavelang/shape

Shape expectations and knowledge health (spec §20): schema as claims,
checked against the store's own `EXTENDS` taxonomy — plus the read that
looks at everything the append-only model keeps side by side, and alias
discovery (spec §27), which proposes what §13.6 should merge.

Expectations are ordinary in-band claims on the `EXPECTS` meta-verb
(standard prelude, §20.1):

```cave
service EXPECTS owner        ; instances carry HAS owner: …
service EXPECTS USES         ; instances appear as subject of a USES claim
team EXPECTS PART-OF         ; met by a stored `org CONTAINS team-x` (§5.5)
team EXPECTS PART-OF #cardinality:one ; exactly one current parent
service EXPECTS latency #unit:ms      ; current value must use ms
microservice EXTENDS service ; instances of microservice inherit the shape
api-gateway IS microservice
```

`#cardinality:one` changes the compatible one-or-more default into exactly
one current match. It is primarily useful for relations because an attribute
claim key already has one current value. `#unit:<unit>` applies to attributes
and requires exact normalized-unit equality; unitless values and implicit
conversions such as `s` to `ms` do not satisfy it. Violations carry the
observed count and distinct units, so CLI and JSON reports explain the mismatch.

```ts
import { check, gatedIngest } from '@cavelang/shape'

check(store)
// → { violations: [{ entity: 'api-gateway', via: 'microservice',
//      expectation: { type: 'service', kind: 'attribute', name: 'owner', … } }],
//     stale, review, disagreements, coverage }

gatedIngest(store, 'cache IS service', { source: 'cli' })
// → { ok: false, violations: […] } — rolled back atomically (§20.3)
```

## The report (§20.2)

`check(store, { staleDays?, now? })` reads, never writes:

- **violations** — (instance, expectation) pairs currently unsatisfied;
  the failing section (`cave check` exits 1 on any).
- **stale** — current beliefs whose tx timestamp (UUIDv7 encodes
  wall-clock ms) is older than the horizon (default 90 days). Appending a
  fresh belief to the series resets the clock.
- **review** — current beliefs at `conf 0.3–0.7` (§13.5).
- **disagreements** — cross-series conflicts inside alias closure groups
  (§13.6 keeps aliased series separate; this is what looks at them):
  same verb+attribute with different values, or same verb+object asserted
  by one name and negated by another. Series scoped to different
  non-`src:` contexts describe different facts and never disagree; actor
  provenance stamps (§9.5) are provenance, not scope.
- **coverage** — the §17.6 precursor: row/fact/belief-state counts,
  confidence distribution, typed-entity fraction, expectation
  satisfaction.

## Write gating (§20.3)

`gatedIngest(store, text, { strict?, source? })` appends, re-evaluates,
and rolls back (savepoint transaction, in-memory registry included) when
the append *introduces* violations that were not present before —
including against expectations the text itself declares. Pre-existing
violations never block: the gate compares, it does not demand a clean
store. `cave add --check` is the first enforcement point; action
preconditions reuse the same mechanism.

## Typed client generation (§20.4)

`generateClient(store)` deterministically turns current expectations into a
versioned TypeScript module; `cave generate --db k.db --out cave-client.ts`
writes the same bytes. Generated interfaces preserve exact field names,
attribute text/number/unit values, inverse-aware relations, arrays for the
compatible `some` cardinality, and runtime-checked scalars for
`#cardinality:one`.

```ts
const generated = generateClient(store)
if (!generated.ok) throw new Error(generated.problems.join('\n'))
// generated.version === 1
// generated.digest === SHA-256 of the normalized versioned schema
// generated.code is the complete TypeScript module
```

The file embeds its normalized schema, format version and digest. Sorting uses
code-point order, so append order and locale do not alter output. Conflicting
declarations, invalid/repeated cardinality or unit tags, relation units,
unsupported versions, and type-name collisions are reported together before
any CLI output file is written. Text and CAVE-Q stay primary; this module is a
reviewable derived artifact, regenerated when `EXPECTS` claims evolve.

## Alias discovery (§27)

Under LLM extraction the same entity drifts across names; discovery
finds the pairs, review decides them:

```ts
import { suggestAliases, writeSuggestions } from '@cavelang/shape'

suggestAliases(store)
// → [{ entity: 'grandma-maria', canonical: 'maria', score: 0.7,
//      confidence: 0.35, signals: [{ kind: 'tokens', … }],
//      line: 'grandma-maria ALIAS maria #suggested @ 35% ; segments of maria within grandma-maria' }]

writeSuggestions(store, suggestAliases(store))  // append, stamped @src:suggest/alias
```

- **Signals are deterministic and explainable** — normalized-name
  equality, segment reorder/containment, prefixes, edit similarity
  (with a differing-segments guard: `grandma-mria` drifts,
  `north-tower`/`south-tower` doesn't), shared *rare* textual attribute
  values; shared relation neighbors boost a candidate, never create one.
- **Suggestions are questions**: confidence is `score/2` clamped to
  0.3–0.5 — the §20.2 review band — and the evidence rides in the
  line's comment.
- **Decisions stick**: any recorded `ALIAS` history between two names
  (merged, rejected `ALIAS NOT`, or unmerged `@ 0%`) excludes the pair,
  as do closure-group membership, a direct relating claim, and
  scope-parent names.
- **The judge stays out-of-band** (§19.5): `judgePrompt(store,
  suggestions)` / `parseJudgeReply(reply, count)` define the contract;
  the CLI wires any shell agent to it (`cave suggest-alias --agent`).

## Design notes

- **Checking is a read; enforcement is opt-in.** §9.4 write-time
  tolerance is load-bearing — a store must accept claims about entities
  it has no shape for. Nothing here changes what `store.ingest` accepts.
- **Binding through the taxonomy only.** Targets are entities with a
  current positive `IS` claim into the type or its `EXTENDS+`
  descendants — no name globs, which would institute a shadow type
  system. Subclass entities themselves are not instances.
- **Each expectation is its own claim key**, so shapes evolve append-only
  like everything else: retract with `service EXPECTS owner @ 0%`;
  history survives.
- **Constraints are tags, not a type system.** Only `#cardinality:one` and
  attribute `#unit:<unit>` have shape semantics. Omitting them preserves the
  original presence check, and unit conversion remains explicit elsewhere.
