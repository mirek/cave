# `@cavelang/scenario`

Typed, replayable inputs for decision evaluators and formal solver models.
The package binds ordinary CAVE-Q patterns against an explicit transaction-
and valid-time snapshot, then overlays hypothetical CAVE claims inside a
rolled-back savepoint. The returned record is plain immutable data; the scenario
operation leaves no transaction open while an evaluator or Wasm solver runs.
A caller-owned outer transaction remains under the caller's control.

| Task | Start here |
|---|---|
| Choose binding, snapshot and missing-data policies | [Contracts](#contracts) |
| Convert units or combine exact measurements | [Combining measurements](#combining-measurements) |
| Save an evaluation, recommendation or decision | [Explicit result governance](#explicit-result-governance) |
| Recover from a rejected record or retry an existing ID | [Recording and retry](#recording-and-retry) |
| Check a stored solver result against a model/backend | [Replay compatibility](#replay-compatibility) |
| Inspect measured parsing and arithmetic costs | [Performance measurements](#performance-measurements) |

`bind()` first captures the definition's own enumerable data, including nested
snapshot and binding fields. Validation, materialization and digesting use that
captured data, so changing getters cannot give the resulting record a different
identity or policy from the one validated. The capture does not freeze the
caller-owned definition.
Capture traverses nested data iteratively, so deeply nested malformed values
reach field validation instead of exhausting the JavaScript call stack. It
preserves shared references and captures sibling getters before descending into
their values. This removes a stack-depth failure; it does not impose a general
memory or execution-time budget on caller data.
After field validation, binding computes the definition digest before database
access. The complete captured definition, including extra caller metadata, must
be JSON serializable within the runtime's serialization depth. Cycles, BigInt
values and excessive serialization depth reject with `invalid-definition`;
correcting the definition permits a fresh binding on the same store.

`bind()` deeply freezes its returned record, including nested values, evidence
arrays and snapshot fields; `run()` passes that same immutable form to the
evaluator. Strict-mode mutation attempts throw instead of silently changing data
under an already-computed digest. The caller's definition remains mutable and
is not frozen. The returned snapshot contains only the documented snapshot
fields, not unrelated caller metadata. JSON serialization remains available;
parsed copies are ordinary mutable objects whose digests are checked on replay.
Binding checks SQLite's external commit revision and local change count around
materialization. A change that could mix database states throws
`ScenarioInputError` with code `snapshot-changed`; retry the binding before
evaluating. Even a backdated import below the captured transaction head
invalidates that attempt. Rolled-back overlay inserts are accounted for, and
bindings without an overlay remain usable on read-only connections.

Each binding reads the current requested snapshot without retaining a projection
cache. Inside a caller transaction it can observe staged rows. An outer or
savepoint rollback does not rewrite an input record already returned, including
its values, digest and evidence IDs; a fresh binding reflects the restored store.

Given an open `store` containing `system HAS team-size: 8 people`, this
definition evaluates a hypothetical team of 12 without changing that claim:

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

## Combining measurements

Choose a common target unit before summing or comparing measurements. This
complete example converts seconds to milliseconds and sums exactly. Conversion
factors describe target units per source unit; conversions are directed and
are not chained automatically.

```ts
import assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { bind, type Model } from '@cavelang/scenario'

const store = open()
try {
  store.ingest('a HAS duration: 1 s\nb HAS duration: 500 ms')
  const definition: Model.Definition = {
    id: 'total-duration',
    modelDigest: `sha256:${'0'.repeat(64)}`, // replace with your evaluator's model digest
    snapshot: { aliases: 'exact', resolution: 'winner', minimumConfidence: 0.5 },
    bindings: [{
      id: 'duration',
      query: '?job HAS duration: ?value',
      select: 'value',
      expected: {
        kind: 'integer', unit: 'ms',
        conversions: [{ from: 's', to: 'ms', factor: '1000' }]
      },
      cardinality: 'many', reduce: 'sum', scenarioOverride: false,
      policies: { missing: 'reject', contested: 'reject', retracted: 'exclude', unresolved: 'reject' }
    }]
  }
  const inputs = bind(store, definition)
  assert.deepEqual(inputs.values['duration'], {
    kind: 'integer', value: '1500', unit: 'ms', approximate: false
  })
} finally {
  store.close()
}
```

Without the target unit and conversion, these mixed-unit inputs fail with
`incompatible-unit`. Use `reduce: 'all'` to retain separate measurements instead
of computing a total. Each candidate retains its evidence even when reduced.

## Contracts

- `asOf`, `at`, alias handling, resolution, and minimum confidence are frozen
  into every input record. Omitting `asOf` records the exact current head.
  Scenario boundaries use the shared CAVE-Q parsers. Transaction-time `asOf`
  includes the full UTC year, month, day or timestamp second; a UUIDv7 includes
  that exact append. Transaction periods are clipped at the UUID epoch, so
  wholly pre-1970 `asOf` periods contain no recorded transactions. Valid-time
  `at` remains independent and anchors at the start of its named period
  or at the specified timestamp. Both boundaries require valid strings and
  reject impossible calendar dates before database access, even when no
  bindings are requested. UUIDv7 is accepted only for `asOf`.
- `definitionDigest` identifies the complete authored definition, including
  binding queries, types, policies, snapshot settings, and overlay text. Object
  key order and omitted undefined optional fields do not change the digest.
- Winner-mode bindings query resolved candidates directly. Coexisting mode
  reads both unresolved and resolved candidates to identify contested evidence;
  winner mode does not perform that unused unresolved read.
- Cardinality and missing/contested/retracted/unresolved behavior are explicit.
  `many` additionally requires `all`, `min`, `max`, or `sum`; there is no
  implicit first-row policy.
  Unknown or omitted choices in snapshot modes, cardinality, reduction, expected
  value kind, or these policies fail with `ScenarioInputError` (`invalid-definition`)
  before database access. `scenarioOverride` must be an explicit Boolean.
  Malformed definition, snapshot, binding, expected-value and policy containers
  use that same classified error, including nulls and arrays supplied as objects.
  `bindings` must be an array of binding objects without holes; query and supplied
  overlay text must be strings. These checks also protect JavaScript callers
  loading definitions from JSON.
  Numeric target units, when supplied, must be non-empty strings. This is
  checked even for optional or many-valued inputs with no matching rows; omit
  `unit` to retain the authored unit without requesting a conversion.
  A supplied `select` must be a string naming a variable bound by the query,
  without its leading `?` (for example, `select: 'n'` for `?n`). Subject,
  verb, object and attribute value variables are selectable. Invalid selections
  fail before reads, including optional inputs with no matching rows. Only
  Boolean existence inputs may omit `select`.
  Numeric inputs parse the selected variable, just like other input kinds;
  they never substitute an unrelated attribute value from the matching row.
  Selecting an attribute value retains its valid-time interpolation and
  uncertainty. Selecting another slot does not inherit that attribute's
  uncertainty, including when the match comes from an overlay.
  Valid binding names such as `constructor` and `toString` are ordinary keys;
  absent overlay entries never resolve through JavaScript's object prototype.
  Scenario IDs, binding IDs and model digests must be strings at runtime;
  numbers, missing IDs, boxed strings and other coercible values fail before
  database access. The string binding ID `"1"` remains valid, while numeric `1`
  cannot bypass duplicate detection and overwrite that same input slot.
  Enum definitions require a non-empty, dense array of unique strings. A
  string, set, array hole or non-string entry is rejected before reads, even
  for an optional binding with no matching rows. Enum membership uses exact,
  case-sensitive string equality; a substring is not an allowed enum value.
  Boolean `trueValue` and `falseValue` mappings must be strings when supplied
  and must remain distinct after applying the defaults `"true"` and `"false"`.
  Overlapping mappings fail before reads instead of silently favoring true.
  Empty strings remain valid explicit mappings when the two values differ.
- Decimal trailing zeros cancel before large bigint operands are constructed.
  This preserves multiplier and conversion semantics: `1.25000M USD` is exactly
  `1250000 USD`, and `0.125000ms` converts to `1/8000 s` with factor `0.001`.
  The approximation flag is retained independently of exact arithmetic.
  Scalars without a K/M/B/T multiplier reuse the normalized fraction directly.
  Stored long decimal spellings retain exact converted uncertainty, confidence
  and source row evidence; repeating the binding does not append store history.
- Authored decimals and multiplier spellings become exact rationals without a
  JavaScript `number` round trip. Unit changes require a declared exact
  conversion. Approximation, uncertainty, sigma level, and confidence remain
  separate fields and never become solver weights automatically.
  Conversion definitions must be an array of entries with non-empty string
  endpoints and positive exact rational factors. Each directed unit pair may
  appear only once, even with identical factors; the reverse direction is a
  separate pair. Malformed entries and duplicate pairs fail as invalid
  definitions before reads, so array order cannot choose between conflicting
  factors.
  Numeric `sum`, `min` and `max` require all candidates to have the same unit
  after conversion, or all to be unitless. Mixed units (including unitless
  values mixed with units) fail with `incompatible-unit`. Declare a target
  `unit` and explicit conversions to combine compatible measurements. The
  `all` reducer retains each candidate's own unit without combining values.
  Equal-denominator sums add numerators before reduction, and comparisons of
  normalized equal-denominator values compare numerators directly. With positive
  denominators, zero or opposite-sign numerators also determine ordering without
  products; equal nonzero numerators use denominator order with the appropriate
  sign. Same-sign fractions also avoid products when numerator and denominator
  orders reinforce each other, as in the solver's exact comparison. These
  shortcuts avoid expanding intermediate integers in those cases. A 16,900-pair
  integer cross-product regression covers both denominator signs, and large
  reinforcing-order cases check differences below floating-point precision.
  Other comparisons compute each cross-product once and account for the sign of its
  common denominator. Parsing and conversion normalize denominators positive;
  direct internal comparison also orders equivalent negative-denominator forms
  correctly. Binding regressions also cover negative converted values separated
  below floating-point precision: `min` and `max` retain their exact ordering,
  including a positive conversion factor written with two negative components.
  Repeated binding preserves the input record and store history. These paths retain exactness
  while avoiding unnecessarily large intermediates; they impose no work cap.

  See [Performance measurements](#performance-measurements) for reproducible
  parsing, arithmetic and reduction benchmarks.

- Durable evidence uses exact CAVE row IDs. Rolled-back assumptions use stable
  `scenario:<scenario-id>:<overlay-digest>#<claim>` IDs, so replay identity
  does not depend on transient SQLite row IDs.
- Overlay patterns are currently non-transitive and match hypothetical claims
  by their authored entity names. This prevents current alias state from
  leaking into a historical snapshot; transitive overlay composition waits on
  the shared snapshot-query primitives tracked in the backlog.
  Confidence, tag, context and numeric `WHERE` filters use the shared query
  engine for both stored and hypothetical claims. Overlay candidates retain
  their authored confidence and scenario evidence IDs. Temporary rows are
  rolled back before typed input conversion, including conversions that fail.
  Invalid conversion factors report `invalid-definition`; missing unit mappings
  or unitless values with a required target unit report `incompatible-unit`.
  A valid conversion that produces a fraction for an integer binding reports
  `invalid-value`. These failures preserve transaction history. Corrected
  bindings can run immediately, and subsequent unpinned bindings observe new
  committed facts rather than retaining failed overlay values.

Use `run(store, definition, evaluate)` when convenient. It calls `bind`
synchronously and invokes `evaluate` only after the overlay and verb registry
have been restored, including when the evaluator later times out or crashes.
If overlay insertion throws after writing temporary claims or vocabulary,
`run` rejects with that error without invoking the evaluator. The transaction
restores history and the verb registry; the same definition can be retried
after the insertion failure is resolved.
An asynchronous evaluator holds no overlay transaction while its promise is
pending. Subsequent store writes persist whether that promise resolves or
rejects. `run` forwards the evaluator's result or rejection; it does not impose
a deadline or provide cancellation. Configure those in the evaluator itself.

For solver runs, `explanationContext(definition, inputs)` converts the frozen
record into `@cavelang/solver` explanation metadata. It retains every binding's
query, typed and authored value, exact belief/scenario evidence IDs, snapshot
policy, input-record digest, and overlay digest. Input records must use
`cave.scenario/inputs@1`; unsupported schemas reject even when their content
digest matches. Each declared binding must occur exactly once in the record;
missing, duplicate and unknown binding IDs reject before metadata is returned.
Passing that context to
`Solve.runWithExplanation` also rejects replay against a different canonical
model digest.

Before attaching queries to evidence, `explanationContext` verifies both the
definition digest and the input record's content digest. Changed definitions
or modified records fail explicitly. It captures the supplied definition once
before those checks and uses that captured definition for the returned queries.
Changing getters cannot attach a different query after digest validation;
a later call captures fresh values and rejects a changed definition.

The input record is also copied before validation. Checked values and evidence
come from that copy, so changing record getters or later mutations of a
JSON-loaded record cannot rewrite the explanation's validated inputs. A new
call rechecks the supplied record and rejects contents carrying a stale digest.

Older input records without
`definitionDigest` remain readable as stored artifacts but must be rebound
with the intended definition before generating a verified explanation.
Rebinding produces a new input digest; record any new evaluation under a new
run ID so the earlier artifact keeps its original content and provenance.

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

`run()` returns the evaluator's result without copying or freezing it. Its input
record is frozen, but ownership of the returned result stays with the caller.
JSON validation and snapshot capture happen when `Record.result()` is called;
changes to an output before that call become part of the recorded evaluation.

Before recording an external evaluation, `Record.result` requires non-empty
string evaluator names and versions, an explicit JSON output (`null` is valid),
and an input digest matching the supplied input record's contents. Missing
metadata or modified inputs carrying an old digest throw `TypeError` without
appending a claim. This uses the same content-digest check as solver explanation
construction. Previously stored artifacts remain readable; rebind changed
inputs and use a new result ID for a corrected evaluation.

### Recording and retry

Recording captures one JSON snapshot of the supplied artifact before opening
its transaction. Getters are read during that capture; validation, predecessor
checks, identity and stored content all use the captured values. The returned
outcome contains that stored snapshot, so later changes to caller-owned objects
do not change it. Predecessor checks and writes still share one transaction.
The outcome's artifact is a detached, mutable JSON object. Editing it does not
edit stored history; a fresh `Record.read()` returns the stored content, and
recording that unchanged content again returns `existing`.

When several prepared artifacts must be recorded together, wrap their writes
in one synchronous caller transaction:

```ts
store.transaction(() => {
  Record.result(store, evaluation)
  Record.recommendation(store, recommendation)
  Record.decision(store, decision)
})
```

Here `recommendation` and `decision` are already prepared artifacts referencing
the preceding IDs. If any call throws, let the exception escape the callback:
all writes in this transaction roll back, including newly recorded predecessors.
Correct the rejected artifact and retry with the same IDs. Repeating a committed
chain with identical content returns `existing` for each artifact. Perform
evaluation and obtain the human decision before opening this transaction.

Each stable ID owns one append-only artifact series. Re-recording identical
content returns `existing`; reusing the ID for different content anywhere in
its history throws `RecordConflictError`. A retraction makes the record
unavailable to reads and predecessor checks, but retains ownership of its ID.
Explicitly recording identical content restores it with a new claim; different
content requires a new ID. The write is one atomic claim, with canonical JSON
encoded as a code value so export, backup, and sync preserve the complete
model digest, backend/version, snapshot, inputs, evidence, limits, and outcome.
Result reads reuse recording validation: solver explanation schemas must match,
and solver model digests, backend names and versions must be non-empty strings.
External evaluations require evaluator identity, output and a matching input
digest. These checks also apply when a result is read as a predecessor for a
new recommendation or decision. Invalid imported results fail without appending
history; a corrected payload can be read again.
Governance record reads also enforce required payloads, author/action fields,
status choices and non-empty string predecessor IDs using the same validators
as recording. Optional recommendation rationale/author, decision rationale and
action message fields must be strings when present. Empty strings and omission
are accepted; null, numbers, booleans, arrays and objects are rejected without
appending. Imported reads enforce the same rule and recover after a corrected
payload is imported. These checks also reject a malformed immediate predecessor
before a decision, action or external-effect record can be appended. Correcting
that predecessor permits retry with the previously rejected child ID.
Reads validate the local
artifact; predecessor existence and cross-record relationships are checked when
recording a new artifact.
A rejected write with a missing predecessor appends nothing and does not reserve
the attempted artifact ID. Record the required predecessor, then retry the same
artifact ID; subsequent identical retries return the existing row.

Stored artifact payloads must use valid base64url encoding and decode as UTF-8
JSON. Reads accept unpadded output and correctly padded base64url, and reject
ignored characters, excess padding and nonzero unused padding bits. Reading malformed
bytes throws instead of silently replacing them and returning altered audit
data; reads leave stored history unchanged. Explicit replacement characters
and other valid Unicode remain readable.

Artifact JSON accepts finite numbers, strings, booleans, null, dense arrays,
and plain objects. Imported JSON numbers that overflow to infinity, such as
`1e400`, reject at any nesting depth without changing stored history.
Arrays are captured by length and numeric index; custom
iterators cannot replace their contents or hide holes. Object keys are sorted, and optional fields whose value is
`undefined` are omitted. Sparse or undefined array entries, non-JSON objects
such as dates/maps/sets, and cycles throw `TypeError` before any write. Reusing
the same non-cyclic object in multiple fields remains valid; each occurrence
is preserved as JSON data.
Recording validates and serializes containers with explicit stacks, as reads
already do, so deeply nested valid artifacts can be recorded and retried without
call-stack overflow. Serialization retains existing payload bytes, including
numeric-index property ordering. This removes an engine stack limitation; it
does not impose a general artifact memory or size budget.
An ID must remain exactly one CAVE entity name after its namespace prefix is
added. The recorder verifies the complete parsed claim, including the intended
subject and artifact payload, before insertion. Whitespace, comments, or extra
claim syntax that alter this identity are rejected without appending anything;
the same validation applies when reading predecessor references.

`Record.recommendation`, `Record.decision`, `Record.action`, and
`Record.externalEffect` use different versioned schemas and entity namespaces.
Each checks its predecessor before appending. These latter two are audit
records only: they never invoke `@cavelang/act` or a hook. Governed action
execution remains the sole authority for an external effect.

Recording entry points also enforce their artifact schema at runtime, before
opening a transaction. `Record.result` accepts solver results and external
evaluations; each other entry point accepts only its own versioned schema.
Passing an action to `Record.result`, for example, throws `TypeError` instead
of bypassing the action's decision check. Missing and unknown schemas are
rejected at this same boundary, including for JavaScript callers.

Recommendations require `value`, decisions require `selected`, and actions
require `parameters`; explicit JSON `null` is valid for each. Decision
`decidedBy`, action `name` and external-effect `kind` must be non-empty strings.
Action status must be `validated`, `executed` or `failed`; external-effect
status must be `succeeded`, `failed` or `unknown`. Missing required fields and
unsupported statuses throw `TypeError` without appending, while predecessor
checks still run under the recording transaction. Optional rationale, message
and effect details remain optional. These audit records never execute effects.

Solver result records require a supported explanation outcome: `satisfied`,
`optimal`, `unsatisfied`, or `unknown`. Optimal outcomes require literal
`optimalityProved: true`; unsatisfied outcomes require literal
`infeasibilityProved: true` and `coreMinimal: false`, even when no core was
returned. The portable explanation contract does not certify core minimality;
missing, true or coerced minimality markers are rejected. Recording, reading
imported artifacts, replay and
predecessor checks all enforce these markers before a result can support a
recommendation or decision. This checks the report contract; it does not
independently verify a backend's proof. Report inputs and diagnostics must be
arrays, as must feasible assignments and hard/soft constraints, optimal
objectives, and an unsatisfied core when supplied. Missing required collections
and non-array values reject at the same recording and read boundaries.
Unknown outcomes require a portable reason kind, string message and, when
present, a supported limit name. Recording and reading use the same
`Validate.unknownReason` check as solver-result handling, so replay cannot accept
a malformed unknown reason based only on matching model/backend identity.
Shared `Validate.resultMetadata` validation also requires finite non-negative
elapsed time and well-formed diagnostic entries, with supported severity and
string code/message fields. These checks apply before imported results can be
replayed or used as predecessors, as well as before initial recording.
Input and outcome entries must be objects with string IDs and the appropriate
string provenance arrays. Optional descriptions, queries and evaluation reasons
must be strings; declaration positions must be positive safe integers.
Assignments, objectives and core entries require Boolean `declared` flags.
Constraint evaluation states, objective directions and soft-weight field shapes
are checked before recording or replay. These structural checks do not resolve
referenced IDs or independently evaluate a solution. JSON-compatible malformed
raw backend assignment/objective values remain recordable for inspection and render with the
invalid-value marker.
Recorded run context also passes `Validate.explanationContext`, enforcing the
same snapshot policy, scenario identity and unique input-ID checks as generated
explanations. Limits must be an object with supported names and positive safe
integer values. Historical objects that omit newer limits retain exactly their
declared fields: validation does not insert current defaults into old evidence.
These checks apply to recording, imported reads, replay and predecessor use.
Indeterminate local constraint
evaluations remain recordable, including their optional `evaluationReason`.
This includes local `maxExplanationBits` exhaustion: replay retains the recorded
budget and indeterminate evaluations without running arithmetic again or
reclassifying the backend outcome.
A fresh solve with a larger explanation budget may evaluate constraints that
were previously indeterminate, without changing the model digest. Record that
new report under a new result ID; the earlier result remains immutable, including
after canonical export/import. Replay reads its recorded evaluation and does
not invoke the backend or apply the current caller's budget.

### Replay compatibility

`Record.replay` reads an immutable solver report without solving again and returns
explicit incompatibility reasons for a different model digest, backend, or
solver version. Each replay captures the expected model digest, backend name
and version once, so compatibility checks and their diagnostics use the same
values even when supplied through getters. A later replay captures fresh
expectations; neither call changes recorded history.
Expected model digests and supplied backend names/versions must be nonempty
strings. Malformed expectation containers or identities throw `TypeError` before
store reads; valid but different identities return incompatibility reasons.
Omit `backend` to compare only the model digest.
External evaluations retain their exact evaluator identity and
input digest through `Record.read`; they are never mistaken for solver replay.

## Performance measurements

Run these benchmarks alone from the repository root. They check exact results
outside the timed calls. Measurements describe the audit machine and the named
runtime versions; they are not test thresholds or general resource guarantees.

### Scalar parsing

Run `node scripts/scenario-parse-normalization-bench.mjs` alone to measure
parsing at 1,000, 10,000 and 100,000 decimal places. Five-sample medians for
the 100,000-place fixture fell from 37.64 to 18.64 ms on Node 24.21.0 and
37.23 to 18.44 ms on Node 26.8.1 after removing duplicate normalization.
These are local measurements, not a general input-size or latency guarantee.

### Arithmetic and fraction reduction

Run `node scripts/scenario-exact-bench.mjs` from the repository root, alone,
to measure addition and comparison of near-one fractions at 1,000–64,000
decimal places. Three-sample medians at 64,000 places on the audit machine:

| Runtime | Addition before → after | Comparison before → after |
|---|---:|---:|
| Node 24.16.0 | 26.11 → 13.82 ms | 14.56 → 5.67 ms |
| Node 26.5.0 | 25.93 → 13.75 ms | 14.47 → 5.71 ms |

The same script also measures unequal-denominator comparisons at 10,000 and
100,000 digits: opposite signs, equal numerators and a general cross-product
control. These additional cases use two warmups and eleven measured calls,
reporting the median with runtime/platform and measurement-scope metadata.
Input construction and exact result assertions are outside timing; BigInt
parsing inside comparison is included. Run the script alone on each runtime;
these observations are not a CI threshold or an intermediate-size budget.

The before/after table covers common denominators. Unit-conversion products,
unequal-denominator addition and general intermediate growth remain separate
resource boundaries; timings are observations, not test thresholds.

Fraction reduction shares the solver's `Exact.fromBigInts` normalizer, using
its guarded Lehmer batches directly on bigint intermediates. This avoids both
a second GCD implementation and an intermediate decimal serialization step.
`node scripts/scenario-reduction-bench.mjs` measures adding zero and converting
one source unit using consecutive Fibonacci fractions at indices
5,000–100,000, with fixture construction outside timing and exact-result
checks afterward. Three-sample medians at index 100,000 (41,798 numerator plus
denominator digits), measured alone on the audit machine:

| Runtime | Add zero before → after | Conversion before → after |
|---|---:|---:|
| Node 24.16.0 | 1461.95 → 34.04 ms | 1492.44 → 70.80 ms |
| Node 26.5.0 | 1449.63 → 32.66 ms | 1483.08 → 66.02 ms |

The 64,000-place common-denominator addition benchmark still measured about
14 ms on both runtimes. Conversion includes normalizing the declared factor
and its product; general product growth and normalization work remain unbounded.
