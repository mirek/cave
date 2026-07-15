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
optimization after the portable model, Z3 backend, and
[MiniZinc evaluation](minizinc-backend.md) are proven.

HiGHS is a strong candidate for linear programming and mixed-integer linear
programming. The maintained `highs` JavaScript package compiles HiGHS to a
substantially smaller Wasm artifact than Z3 and runs in Node and browsers, but
its public input is primarily CPLEX LP text and its logical and explanation
capabilities are narrower.

MiniZinc can also target HiGHS while adding a solver-independent modeling
layer and other finite-domain backends. A direct adapter is therefore not the
default second backend: it must demonstrate useful performance, packaging, or
diagnostic advantages over both Z3 and MiniZinc targeting HiGHS.

## Scope

- Compile only the recognized linear subset of the portable model.
- Emit stable, escaped LP identifiers and retain a reverse ID map.
- Preserve integer, binary, bounds, objective ordering, and coefficient
  precision within documented backend limits.
- Return feasible/optimal/infeasible/unknown without pretending to provide Z3
  theories or equivalent unsat cores.
- Compare objective values and assignments with the Z3 adapter and MiniZinc
  targeting HiGHS on shared linear fixtures.

## Benchmark gate

Use representative CAVE workloads rather than toy LPs:

- portfolio or budget allocation;
- service capacity planning;
- assignment under resource limits; and
- a scaled architecture trade-off model.

Measure bundle size, cold and warm latency, memory, optimality, diagnostics,
and packaging reliability. Include model sizes large enough to reveal a real
difference between Z3, MiniZinc-to-HiGHS, and direct HiGHS.

## Done when

- The portable model can identify and compile its linear subset deterministically.
- Shared fixtures give equivalent feasible sets and objective values within an
  explicit numeric tolerance.
- Unsupported logical constructs fail before invoking HiGHS.
- Benchmark evidence justifies maintaining a direct adapter in addition to
  MiniZinc's HiGHS route.
- Backend selection is explicit or capability-driven, never a silent semantic
  fallback.
