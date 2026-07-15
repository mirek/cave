---
name: formal-verification-z3-feasibility-spike
description: Prove the official Z3 TypeScript and Wasm bindings fit CAVE.
status: completed
priority: low
area: reasoning
source: solver-feasibility-analysis
---

# Prove Z3 feasibility

## Goal

Build a disposable Node-first adapter spike using the official `z3-solver`
package. The spike validates the risky integration points before Z3 becomes a
runtime dependency.

## Required experiments

- Compile Boolean, bounded integer, exact rational, and finite-enum variables.
- Check satisfiability and extract a stable assignment.
- Track named constraints and map an unsatisfiable core back to their IDs.
- Minimize and maximize one objective, then exercise lexicographic objectives.
- Exercise explicitly weighted soft constraints without involving CAVE
  confidence.
- Pass decimal strings as exact rational numerals and round-trip model values.
- Apply wall-clock and solver resource limits and report `unknown` correctly.
- Initialize once for a long-lived CLI/MCP process.
- Terminate Emscripten worker threads cleanly for a short-lived command.
- Verify that two simultaneous solve requests are deliberately queued or
  isolated rather than accidentally sharing a non-thread-safe context.

## Packaging experiment

Measure and record:

- installed and compressed artifact size;
- cold initialization and first-check latency;
- warm solve latency for representative fixtures;
- peak memory;
- worker and Wasm asset resolution in packed packages; and
- behavior under Node versions supported by CAVE.

The feasibility analysis observed that the Wasm artifact is large and threaded,
so the adapter must be dynamically imported and absent from normal startup when
unused.

## Decision gate

Accept Z3 when it can produce a model, an optimization result, and an unsat
core through the portable API with bounded execution and clean shutdown. Reject
or isolate it further if worker lifecycle, packaging, or memory makes ordinary
CLI and MCP use unreliable.

## Done when

- The architecture decision fixture covers satisfied, optimal, unsatisfied,
  and unknown results.
- Constraint IDs survive compilation and unsat-core extraction.
- Exact rational tests do not route through JavaScript floating point.
- Tests pin initialization, concurrency, timeout, and cleanup behavior.
- A benchmark report records artifact size, latency, and memory on CI-relevant
  platforms.
- No CAVE core package imports `z3-solver`.

## Outcome

Implemented by the optional `@cavelang/solver-z3` package against official
`z3-solver` 4.16.0. The adapter dynamically initializes one process runtime,
serializes solve requests, compiles the full portable expression model, maps
tracked cores back to constraint IDs, preserves exact rationals, applies
solver and wall-clock deadlines, bounds output, and terminates Emscripten
workers on explicit shutdown. Focused tests cover all result states,
lexicographic and weighted-soft optimization, concurrency, packaging, and
short-lived process cleanup. `packages/solver-z3/BENCHMARK.md` records size,
latency, and memory measurements.

The decision gate accepts Z3 for opt-in Node.js use. It remains outside every
core package and default CLI/MCP/browser dependency graph; browser delivery is
still deferred to the runtime-hardening work package.
