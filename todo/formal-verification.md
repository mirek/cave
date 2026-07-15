---
name: formal-verification
description: Add solver-backed feasibility, optimization, counterexamples, and unsatisfiable explanations.
status: open
priority: low
area: reasoning
source: solver-feasibility-analysis
---

# Formal verification and constraint solving

## Problem

CAVE-Q finds stored knowledge and the rules engine derives additional claims,
but neither searches a space of possible assignments. CAVE therefore cannot
yet answer questions such as:

- Is there any configuration that satisfies every hard requirement?
- Which feasible configuration minimizes cost or operational complexity?
- Which assumptions make a scenario impossible?
- What counterexample disproves a proposed policy invariant?
- At what input boundary does one recommendation overtake another?

Application code can answer these questions ad hoc, but then typing,
provenance, resource limits, and result semantics vary by integration. Putting
solver state directly into the claim store would create the opposite problem:
hypothetical assignments could be mistaken for durable beliefs.

## Decision

Add an optional solver backend behind a small, solver-neutral TypeScript model.
Use Z3 as the first formal backend because its official `z3-solver` package
provides TypeScript bindings and WebAssembly for Boolean logic, exact integer
and real arithmetic, optimization, soft constraints, models, and unsatisfiable
cores. Keep HiGHS as a later backend for workloads that are naturally linear
or mixed-integer optimization.

This is an extension of the [decision and scenario
layer](decision-scenario-layer.md), not a replacement for CAVE-Q or rules:

| Mechanism | Responsibility |
|---|---|
| CAVE-Q | Find beliefs already present in a selected snapshot. |
| Rules | Derive new claims by forward chaining over beliefs. |
| Solver | Search assignments, prove infeasibility, optimize, and find counterexamples. |

The solver is optional, lazily loaded, and outside the knowledge kernel. The
core store, parser, query, and rule packages must not depend on Z3, HiGHS, or a
particular solver expression type.

## Preconditions

Do not make solver-backed decisions authoritative until the storage and query
snapshot is trustworthy. In particular, complete or explicitly account for:

- [storage schema migrations](storage-schema-migrations.md);
- [database-backed transaction ordering](database-backed-transaction-order.md);
- [exact backup and restore](exact-backup-restore.md);
- [transitive depth truncation](transitive-depth-truncation.md);
- [shared query primitives](shared-query-primitives.md);
- [stable external records](stable-external-records.md); and
- [value-shape expectations](value-shape-expectations.md) for units and
  cardinality.

These are ordering constraints, not reasons to couple solver code to storage
internals.

## Work packages

Implement the work in independently reviewable stages:

1. [Add verification workflows](formal-verification/verification-workflows.md)
   — expose feasibility, optimization, counterexample, and sensitivity
   operations without inventing a second rule engine.
2. [Govern result recording](formal-verification/result-governance.md) — keep
   ephemeral recommendations separate from facts, decisions, and executed
   actions.
3. [Evaluate a HiGHS backend](formal-verification/highs-backend.md) — add it only
   when representative linear/MIP workloads justify a second adapter.
4. [Harden runtime and browser delivery](formal-verification/runtime-browser.md)
   — bound hostile models, isolate execution, and keep large Wasm artifacts out
   of default bundles.

## Semantic rules

- CAVE confidence is epistemic confidence. It is never silently converted to
  an objective coefficient or soft-constraint weight.
- Hardness, preference weight, cost, forecast probability, and belief
  confidence remain distinct typed values.
- `unsatisfied` means the selected model was proved infeasible. A timeout,
  resource limit, unsupported expression, or solver failure is `unknown`.
- `optimal` means optimal under the named model, inputs, objectives, solver
  semantics, and snapshot. It does not mean objectively best in the world.
- Exact decimal strings compile to exact rational constants where supported;
  they do not round-trip through JavaScript `number` first.
- Units are checked and normalized before solver compilation. Solver variables
  do not acquire implicit units.
- Multiple matching beliefs require an explicit cardinality and resolution
  policy. The compiler never silently takes the first row.
- A recommendation is not an executed decision, and an executed decision is
  not proof that the recommendation was correct.

## Non-goals

- Translating the entire open-world CAVE graph into one permanent solver model.
- Replacing SQL query compilation or forward-chaining rules.
- Adding quantifiers, arbitrary SMT-LIB, or executable JavaScript to the CAVE
  language in the first version.
- Letting agents submit raw solver programs through MCP.
- Automatically writing a satisfying assignment or recommendation into the
  base store.
- Shipping Z3 in the default CLI, MCP, or website bundle when no model uses it.

## Representative acceptance scenario

The first end-to-end fixture should compare monolith and microservices using
typed inputs such as team size, expected load, deployment frequency, regulatory
isolation, and acceptable operational complexity. It must demonstrate:

1. a feasible recommendation with named objective contributions;
2. an infeasible scenario with an unsatisfiable core mapped to its source
   claims;
3. a counterfactual boundary where the preferred option changes;
4. no durable store mutation without an explicit record operation; and
5. deterministic replay against the same model digest and belief snapshot.

The fixture should also prove that a simple weighted-score decision can remain
on the ordinary decision evaluator: a solver is justified only where choices
interact, constraints exclude combinations, or formal counterexamples add
value.

## Done when

- One solver-neutral model compiles through the Z3 adapter without exposing Z3
  types above the adapter boundary.
- Feasible, optimal, unsatisfied, and unknown results are distinct and tested.
- Every generated constraint has a stable ID and optional evidence row IDs.
- Scenario inputs and solver results are typed, versioned, replayable, and
  non-mutating by default.
- Unsatisfiable cores and counterexamples render as CAVE-aware explanations.
- Recorded outputs include the model digest, solver/version, snapshot,
  explicit inputs, and provenance.
- Time, memory, expression-count, and output-size limits are enforced.
- Z3 and its worker assets are lazy optional dependencies.
- A benchmark decides whether HiGHS and browser support provide enough value
  to ship.
