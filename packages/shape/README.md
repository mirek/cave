# @cavelang/shape

Shape expectations and knowledge health (spec §20): schema as claims,
checked against the store's own `EXTENDS` taxonomy — plus the read that
looks at everything the append-only model keeps side by side.

Expectations are ordinary in-band claims on the `EXPECTS` meta-verb
(standard prelude, §20.1):

```cave
service EXPECTS owner        ; instances carry HAS owner: …
service EXPECTS USES         ; instances appear as subject of a USES claim
team EXPECTS PART-OF         ; met by a stored `org CONTAINS team-x` (§5.5)
microservice EXTENDS service ; instances of microservice inherit the shape
api-gateway IS microservice
```

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
