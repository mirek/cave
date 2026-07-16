# `@cavelang/scenario`

Typed, replayable inputs for decision evaluators and formal solver models.
The package binds ordinary CAVE-Q patterns against an explicit transaction-
and valid-time snapshot, then overlays hypothetical CAVE claims inside a
rolled-back savepoint. The returned record is plain immutable data; no
database transaction remains open while an evaluator or Wasm solver runs.

```ts
import { bind, explanationContext, Model } from '@cavelang/scenario'

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

For solver runs, `explanationContext(definition, inputs)` converts the frozen
record into `@cavelang/solver` explanation metadata. It retains every binding's
query, typed and authored value, exact belief/scenario evidence IDs, snapshot
policy, input-record digest, and overlay digest. Passing that context to
`Solve.runWithExplanation` also rejects replay against a different canonical
model digest.

```ts
const inputs = bind(store, definition)
const report = await Solve.runWithExplanation(
  adapter,
  model,
  { unsatCore: true },
  explanationContext(definition, inputs)
)
```

## Explicit result governance

Evaluation remains ephemeral. The `Record` API is the only transition from a
plain solver report or ordinary evaluator output into durable CAVE history:

```ts
import { Record } from '@cavelang/scenario'

Record.result(store, {
  schema: Record.resultSchema,
  id: 'architecture-2026-07-15',
  report
})
```

An ordinary deterministic evaluator uses the same frozen input record and a
separately versioned result—no solver is required:

```ts
const evaluation = await run(store, definition, inputs => ({
  schema: Record.evaluationSchema,
  id: 'architecture-evaluation',
  inputs,
  evaluator: { name: 'architecture-threshold', version: '1.0.0' },
  output: { architecture: 'monolith' }
} satisfies Record.Evaluation))

Record.result(store, evaluation)
Record.recommendation(store, {
  schema: Record.recommendationSchema,
  id: 'architecture-recommendation',
  resultId: evaluation.id,
  value: evaluation.output
})
Record.decision(store, {
  schema: Record.decisionSchema,
  id: 'architecture-decision',
  resultId: evaluation.id,
  recommendationId: 'architecture-recommendation',
  selected: evaluation.output,
  decidedBy: 'human/mirek'
})
```

`cave.scenario/evaluation@1` records the exact `inputs` (snapshot, overlay,
evidence, and digest), evaluator name/version, and JSON output. The evaluator
runs only after rollback; recording, recommendation, and human decision remain
three explicit operations. The package test suite exercises this complete
non-solver architecture-choice workflow.

Each stable ID owns one append-only artifact series. Re-recording identical
content returns `existing`; reusing the ID for different content throws
`RecordConflictError`. The write is one atomic claim, with canonical JSON
encoded as a code value so export, backup, and sync preserve the complete
model digest, backend/version, snapshot, inputs, evidence, limits, and outcome.

`Record.recommendation`, `Record.decision`, `Record.action`, and
`Record.externalEffect` use different versioned schemas and entity namespaces.
Each checks its predecessor before appending. These latter two are audit
records only: they never invoke `@cavelang/act` or a hook. Governed action
execution remains the sole authority for an external effect.

`Record.replay` reads an immutable solver report without solving again and returns
explicit incompatibility reasons for a different model digest, backend, or
solver version. External evaluations retain their exact evaluator identity and
input digest through `Record.read`; they are never mistaken for solver replay.
