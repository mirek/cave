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
but neither searches a space of possible assignments. The shipped
solver-neutral TypeScript model, optional Z3 adapter, and named workflows now
provide feasibility, optimization, counterexample, sensitivity, exact-model,
and unsatisfiable-core machinery. Remaining work is to decide whether narrower
numeric backends add enough value and to harden optional runtime delivery.

The available workflows answer questions such as:

- Is there any configuration that satisfies every hard requirement?
- Which feasible configuration minimizes cost or operational complexity?
- Which assumptions make a scenario impossible?
- What counterexample disproves a proposed policy invariant?
- At what input boundary does one recommendation overtake another?

Application code should use those workflows rather than recreate typing,
provenance, resource limits, and result semantics ad hoc. Solver state remains
ephemeral unless it crosses the explicit immutable recording boundary.

## Current state

Available foundations are:

- `@cavelang/scenario` binds typed, replayable belief snapshots and rolls back
  hypothetical overlays;
- `@cavelang/solver` defines exact portable models, result states, limits,
  canonical digests, provenance-aware explanations, and bounded feasibility,
  optimization, counterexample, and sensitivity workflows; and
- `@cavelang/solver-z3` proves optional Node.js feasibility, optimization,
  tracked cores, timeout handling, explicit worker lifecycle, and an
  allowlisted architecture-workflow CLI fixture; and
- `@cavelang/scenario` explicitly records immutable solver artifacts while
  keeping recommendations, decisions, action audits, and effect audits
  separate, with compatibility-aware replay and scoped MCP authority.

The [MiniZinc evaluation](../packages/solver/MINIZINC-EVALUATION.md) deferred an
adapter until a concrete workflow justifies a solver-neutral indexed/global-
constraint schema. Remaining work is direct HiGHS evaluation for the existing
linear subset, followed by hardened/browser delivery.

## Decision

Add an optional solver backend behind a small, solver-neutral TypeScript model.
Use Z3 as the first formal backend because its official `z3-solver` package
provides TypeScript bindings and WebAssembly for Boolean logic, exact integer
and real arithmetic, optimization, soft constraints, models, and unsatisfiable
cores. MiniZinc remains a deferred candidate for bounded finite-domain,
scheduling, allocation, and other combinatorial models after the portable
schema has a real use case. Evaluate direct HiGHS independently for the
already-recognized linear and mixed-integer subset.

This is an extension of the [decision and scenario
layer](decision-scenario-layer.md), not a replacement for CAVE-Q or rules:

| Mechanism | Responsibility |
|---|---|
| CAVE-Q | Find beliefs already present in a selected snapshot. |
| Rules | Derive new claims by forward chaining over beliefs. |
| Solver | Search assignments, prove infeasibility, optimize, and find counterexamples. |

The solver is optional, lazily loaded, and outside the knowledge kernel. The
core store, parser, query, and rule packages must not depend on Z3, MiniZinc,
HiGHS, or a particular solver expression type.

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

1. [Evaluate a direct HiGHS backend](formal-verification/highs-backend.md) — add
   it only when representative linear/MIP workloads outperform or package more
   cleanly than Z3; compare MiniZinc's HiGHS route only if MiniZinc is revisited.
2. [Harden runtime and browser delivery](formal-verification/runtime-browser.md)
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

## Done when

- Time, memory, expression-count, and output-size limits are enforced.
- Benchmarks decide whether direct HiGHS provides enough distinct value to
  maintain alongside Z3.
- Browser support ships only after explicit deployment, isolation, asset,
  cancellation, and packed-package gates pass.
