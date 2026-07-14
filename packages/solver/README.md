# @cavelang/solver

Solver-neutral TypeScript contracts for CAVE formal reasoning. The package
defines exact, serializable models; validation; capability negotiation;
resource limits; canonical model digests; result states; and linear-subset
recognition. It does not depend on Z3, HiGHS, SQLite, or another CAVE package.

```ts
import { Adapter, Model, Solve } from '@cavelang/solver'

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
