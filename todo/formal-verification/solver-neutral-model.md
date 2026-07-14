---
name: formal-verification-solver-neutral-model
description: Define a typed solver-neutral decision model and result contract.
status: open
priority: low
area: reasoning
source: solver-feasibility-analysis
---

# Define the solver-neutral model

## Goal

Make formal reasoning a runtime capability rather than a Z3-shaped public API.
The model must be expressive enough for the first decision and verification
workflows while remaining implementable by more than one backend.

## Initial model

Define immutable TypeScript data for:

- Boolean, bounded integer, exact real, and finite-enum variables;
- typed constants and references;
- Boolean connectives and comparisons;
- integer and rational arithmetic;
- conditional expressions;
- named hard constraints;
- explicitly weighted soft constraints;
- ordered minimize/maximize objectives; and
- stable variable, constraint, and objective identifiers.

Keep unsupported features explicit. Quantifiers, nonlinear transcendental
functions, recursive definitions, arrays, bit-vectors, and solver-specific
tactics are not part of the portable first version.

## Adapter contract

An adapter advertises capabilities and accepts only the portable model plus
limits. Its result is one of:

- `satisfied` with a model;
- `optimal` with assignments, objective values, and available bounds;
- `unsatisfied` with an optional constraint core; or
- `unknown` with a structured reason.

Results also carry diagnostics, elapsed time, backend/version, and whether an
optimality or infeasibility claim was actually proved.

## Design constraints

- Represent rational constants exactly as signed numerator/denominator or a
  validated decimal string, never only as IEEE-754 numbers.
- Validate sort compatibility before invoking a backend.
- Give serialization a version and canonical form so a model digest is stable.
- Preserve declaration order only where it has semantics, such as
  lexicographic objectives; otherwise canonicalize by stable identifier.
- Do not place adapter classes or Wasm handles in the durable model.
- Make capability failures deterministic and distinguish them from solver
  `unknown` results.

## Done when

- The portable model and result union compile without importing a solver.
- Invalid sorts, duplicate identifiers, unbounded domains where prohibited,
  non-finite values, and unsupported operations fail before solving.
- Canonical serialization and digest tests cover ordering and exact numbers.
- A fake adapter exercises all result states and resource-limit plumbing.
- A linear subset can be recognized without inspecting a backend-specific AST.
