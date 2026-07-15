---
name: formal-verification-highs-backend
description: Evaluate direct HiGHS integration for linear and mixed-integer decision models.
status: open
priority: low
area: reasoning
source: solver-feasibility-analysis
---

# Evaluate a direct HiGHS backend

## Goal

Determine whether a direct HiGHS adapter materially improves large numeric
optimization over the portable model and Z3 backend. The
[MiniZinc evaluation](../../packages/solver/MINIZINC-EVALUATION.md) is complete
and deferred adoption until CAVE has a solver-neutral finite-domain schema.

HiGHS is a strong candidate for linear programming and mixed-integer linear
programming. The maintained `highs` JavaScript package compiles HiGHS to a
substantially smaller Wasm artifact than Z3 and runs in Node and browsers, but
its public input is primarily CPLEX LP text and its logical and explanation
capabilities are narrower.

MiniZinc can also target HiGHS, but no MiniZinc adapter currently ships. A
direct adapter must demonstrate useful performance, packaging, or diagnostic
advantages over Z3. Compare MiniZinc targeting HiGHS only if the deferred
finite-domain work is reopened before this evaluation finishes.

## Scope

- Compile only the recognized linear subset of the portable model.
- Emit stable, escaped LP identifiers and retain a reverse ID map.
- Preserve integer, binary, bounds, objective ordering, and coefficient
  precision within documented backend limits.
- Return feasible/optimal/infeasible/unknown without pretending to provide Z3
  theories or equivalent unsat cores.
- Compare objective values and assignments with the Z3 adapter on shared
  linear fixtures.

## Benchmark gate

Use representative CAVE workloads rather than toy LPs:

- portfolio or budget allocation;
- service capacity planning;
- assignment under resource limits; and
- a scaled architecture trade-off model.

Measure bundle size, cold and warm latency, memory, optimality, diagnostics,
and packaging reliability. Include model sizes large enough to reveal a real
difference between Z3 and direct HiGHS.

## Done when

- The portable model can identify and compile its linear subset deterministically.
- Shared fixtures give equivalent feasible sets and objective values within an
  explicit numeric tolerance.
- Unsupported logical constructs fail before invoking HiGHS.
- Benchmark evidence justifies maintaining a direct adapter alongside Z3.
- Backend selection is explicit or capability-driven, never a silent semantic
  fallback.
