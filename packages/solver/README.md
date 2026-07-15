# @cavelang/solver

Solver-neutral TypeScript contracts for CAVE formal reasoning. The package
defines exact, serializable models; validation; capability negotiation;
resource limits; canonical model digests; result states; and linear-subset
recognition. It does not depend on Z3, HiGHS, SQLite, or another CAVE package.

```ts
import { Adapter, Explain, Model, Solve } from '@cavelang/solver'

const model: Model.t = {
  schema: Model.schema,
  variables: [{ id: 'replicas', sort: 'int', min: 1, max: 20 }],
  constraints: [{
    id: 'capacity',
    expression: {
      kind: 'gte',
      left: { kind: 'variable', id: 'replicas' },
      right: { kind: 'literal', sort: 'int', value: 3 }
    }
  }],
  objectives: [{
    id: 'fewest-replicas',
    direction: 'minimize',
    expression: { kind: 'variable', id: 'replicas' }
  }]
}

declare const adapter: Adapter.t
const result = await Solve.run(adapter, model, {
  limits: { timeoutMs: 2_000 }
})
```

Exact real literals are decimal strings or numerator/denominator pairs. They
are normalized with `bigint`; no decimal is routed through JavaScript floating
point. Objective array order is lexicographic priority. CAVE confidence is not
part of this model and is never interpreted as a soft-constraint weight.

## Portable semantics

- Integer variables always have inclusive finite bounds. Real variables may
  have either, both, or neither bound because SMT backends support exact
  unbounded rational domains.
- Mixed integer/real arithmetic promotes the integer operand to an exact real.
  Division always returns an exact real; it never uses JavaScript or
  backend-specific integer-division behavior.
- `add`, `subtract`, `multiply`, and `negate` are exact. Multiplication of two
  variable-bearing expressions is portable but requires the
  `nonlinear-arithmetic` capability.
- Hard constraints must be Boolean. Soft constraints are Boolean plus an
  explicit positive rational weight. Confidence, probability, uncertainty,
  cost, and preference weight remain different concepts.
- Objectives are evaluated lexicographically in declaration order. A backend
  must advertise `lexicographic-objectives` when a model contains more than
  one objective.
- Enum domains are named finite sets. Enum literals carry the domain ID, so
  values from unrelated domains can never compare accidentally.

Quantifiers, arrays, bit-vectors, recursive definitions, transcendental
functions, raw SMT-LIB, and solver tactics are deliberately absent. A new
portable operation requires a schema version and adapter capability rather
than falling through to backend-specific behavior.

## Validation and identity

`Validate.model` checks schema version, identifiers, duplicate declarations,
exact numerals, bounds, enum membership, references, expression sorts,
constraint/objective types, and preflight model-size limits. Invalid or
unsupported models fail before an adapter runs. Operational limits cover time,
working memory, declarations, enum values, expression nodes/depth, and output
size; every limit is passed to the selected adapter.

`Canonical.serialize` produces stable semantic JSON. Declaration order is
ignored except for objectives, and exact values are reduced to normalized
fractions. Descriptions and evidence row IDs do not affect identity.
`Canonical.digest` returns the full `sha256:<hex>` digest.

## Adapter results

An adapter advertises a backend name/version and a capability set. `Solve.run`
validates the model, merges limits, checks capabilities deterministically, and
only then invokes it. Results are disjoint:

- `satisfied` includes a concrete assignment;
- `optimal` includes assignments, objective values, available bounds, and an
  explicit proof marker;
- `unsatisfied` is allowed only for proved infeasibility and may include a
  stable constraint-ID core; and
- `unknown` carries a structured timeout, resource, cancellation, backend, or
  indeterminate reason.

A feasible assignment returned after an optimization timeout is `unknown`,
not `optimal`. A timeout or unsupported capability is never rendered as proof
that the model is infeasible.

## Provenance and explanations

Variables, constraints, soft constraints, and objectives may carry a stable
declaration URI/line/column, exact CAVE evidence row IDs, and scenario input
IDs. These fields and human descriptions never affect the canonical model
digest.

`Solve.runWithExplanation` wraps any adapter result in versioned, plain JSON.
The report records the canonical digest, backend/version, resolved limits,
diagnostics, optional frozen snapshot and authored inputs, assignments,
evaluated hard and soft constraints, objective contributions, or a mapped
unsatisfiable core. Cores are explicitly not promised minimal and `unknown`
keeps its structured reason.

```ts
const report = await Solve.runWithExplanation(adapter, model, {
  unsatCore: true,
  limits: { timeoutMs: 2_000 }
}, {
  snapshot: { transactionTime: '019c…', validTime: '2026-08-01' },
  inputs: [{
    id: 'team-size',
    query: 'system HAS team-size: ?n',
    value: { kind: 'integer', value: '12', unit: 'people' },
    authoredValue: '0.012K people',
    evidenceRowIds: ['019c…'],
    scenarioClaimIds: []
  }]
})

process.stdout.write(Explain.render(report))
```

The renderer is a deterministic human view over the same JSON report. Neither
building nor rendering an explanation writes to the CAVE store.

## Verification workflows

`Workflow` gives feasibility, optimization, counterexample, and bounded
sensitivity distinct public semantics while keeping one validated model,
snapshot context, adapter limits, and result vocabulary.

```ts
import { Workflow } from '@cavelang/solver'

const feasible = await Workflow.feasibility(adapter, model, {
  limits: { timeoutMs: 2_000 }
}, context)

const best = await Workflow.optimization(adapter, model, {}, context)
const witness = await Workflow.counterexample(
  adapter, model, 'declared-invariant-id', {}, context
)
const boundary = await Workflow.sensitivity(adapter, model, {
  variableId: 'team-size',
  samples: [
    { sort: 'int', value: '4' },
    { sort: 'int', value: '8' },
    { sort: 'int', value: '12' }
  ],
  observe: ['architecture'],
  operation: 'optimization',
  maxRuns: 3
}, {}, context)
```

Workflows require every real variable to have explicit lower and upper bounds.
Sensitivity accepts an explicit, typed sample list and refuses more than
`maxRuns` checks. Its report includes adjacent result transitions and
contiguous `unknown` regions rather than interpolating across timeouts.

Backend model choices are made deterministic with lexicographic objectives in
stable variable-ID order: false before true, smaller exact numbers first, and
enum values in lexical order. In optimization, authored objectives retain
their declared order, explicitly weighted soft constraints follow, and the
tie-break objectives come last. These generated objectives count against
`maxObjectives`; the workflow fails preflight rather than silently dropping
determinism. A merely feasible backend result is never promoted to `optimal`.

Counterexample checks replace one declared invariant with its negation. A
model is a concrete witness; an unsatisfied result means only that the
invariant holds within the report's named assumptions, bounded domains, and
declared Boolean/integer/rational/enum theories. `unknown` remains unknown.
