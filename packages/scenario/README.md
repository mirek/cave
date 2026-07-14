# `@cavelang/scenario`

Typed, replayable inputs for decision evaluators and formal solver models.
The package binds ordinary CAVE-Q patterns against an explicit transaction-
and valid-time snapshot, then overlays hypothetical CAVE claims inside a
rolled-back savepoint. The returned record is plain immutable data; no
database transaction remains open while an evaluator or Wasm solver runs.

```ts
import { bind, Model } from '@cavelang/scenario'

const definition: Model.Definition = {
  id: 'architecture-choice',
  modelDigest: `sha256:${'0'.repeat(64)}`, // use the real model digest
  snapshot: {
    aliases: 'exact',
    resolution: 'winner',
    minimumConfidence: 0.5
  },
  overlay: 'system HAS team-size: 12 people',
  bindings: [{
    id: 'team-size',
    query: 'system HAS team-size: ?n',
    select: 'n',
    expected: { kind: 'integer', unit: 'people' },
    cardinality: 'one',
    scenarioOverride: true,
    policies: {
      missing: 'reject',
      contested: 'reject',
      retracted: 'exclude',
      unresolved: 'reject'
    }
  }]
}

const inputs = bind(store, definition)
// inputs.values['team-size'] is exact integer 12; the store still says 8.
```

## Contracts

- `asOf`, `at`, alias handling, resolution, and minimum confidence are frozen
  into every input record. Omitting `asOf` records the exact current head.
- Cardinality and missing/contested/retracted/unresolved behavior are explicit.
  `many` additionally requires `all`, `min`, `max`, or `sum`; there is no
  implicit first-row policy.
- Authored decimals and multiplier spellings become exact rationals without a
  JavaScript `number` round trip. Unit changes require a declared exact
  conversion. Approximation, uncertainty, sigma level, and confidence remain
  separate fields and never become solver weights automatically.
- Durable evidence uses exact CAVE row IDs. Rolled-back assumptions use stable
  `scenario:<scenario-id>:<overlay-digest>#<claim>` IDs, so replay identity
  does not depend on transient SQLite row IDs.
- Overlay patterns are currently non-transitive and match hypothetical claims
  by their authored entity names. This prevents current alias state from
  leaking into a historical snapshot; transitive overlay composition waits on
  the shared snapshot-query primitives tracked in the backlog.

Use `run(store, definition, evaluate)` when convenient. It calls `bind`
synchronously and invokes `evaluate` only after the overlay and verb registry
have been restored, including when the evaluator later times out or crashes.
