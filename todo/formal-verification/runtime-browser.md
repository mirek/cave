---
name: formal-verification-runtime-browser
description: Bound solver execution and assess safe lazy browser delivery.
status: open
priority: low
area: runtime
source: solver-feasibility-analysis
---

# Harden runtime and browser delivery

## Goal

Treat solver models as resource-consuming untrusted input and keep optional
Wasm engines from degrading ordinary CAVE startup or the website playground.

## Runtime isolation

- Enforce wall-clock, solver resource, memory, variable, constraint,
  expression-depth, enumeration, and output-size limits.
- Run checks in a worker or process that can be terminated independently.
- Reuse one initialized engine where safe, but do not share solver contexts
  across requests.
- Queue or isolate concurrent checks explicitly; do not depend on accidental
  serialization inside a binding.
- Terminate Wasm worker threads for short-lived CLI commands.
- Use stable seeds and deterministic secondary objectives where supported.
- Return `unknown` with a reason for every limit or forced termination.

## Dependency and packaging rules

- Dynamically import each backend only after a validated model selects it.
- Keep solver packages out of core package dependencies and default bundles.
- Test packed npm artifacts so Wasm and worker URLs resolve outside the
  workspace.
- Pin and report the backend version used by every recorded run.

## Browser gate

The current Z3 Wasm binding requires `SharedArrayBuffer`, cross-origin
isolation headers, and separately loadable worker assets. Do not make the
existing GitHub Pages playground depend on it until deployment can provide and
test those requirements reliably.

Evaluate browser delivery independently, using the
[MiniZinc evaluation](../../packages/solver/MINIZINC-EVALUATION.md) and [direct
HiGHS evaluation](../../packages/solver/HIGHS-EVALUATION.md) as the current
deferred baselines:

- lazy Z3 behind a supported deployment configuration;
- MiniZinc's ordinary worker-based Wasm delivery only after a portable
  finite-domain model has a concrete CAVE use case;
- direct HiGHS only after host isolation enforces cancellation and a memory
  ceiling and the portable API names its numeric tolerance semantics; or
- no in-browser solver, preserving the local Node-first capability.

MiniZinc is not automatically the portable choice merely because its browser
build uses Web Workers. Its supported Node entrypoint launches a separately
installed native `minizinc` executable, while its browser distribution ships a
large Wasm module, data file, and worker. Test these as two distinct runtime
profiles, keep every asset lazy, and report the exact MiniZinc and selected
solver versions in results.

Do not introduce a remote solver service merely to make the demo work; that
would weaken CAVE's local-first boundary and add an operational trust surface.

## Done when

- Hostile and accidentally explosive models terminate within configured limits.
- A killed worker leaves no SQLite transaction, temporary claim, or engine
  handle reachable by the next request.
- Normal CLI, MCP, and website startup do not load a solver artifact.
- Packed Node execution resolves Wasm and worker assets on every supported
  platform.
- Browser support ships only with explicit capability detection, deployment
  tests, and a useful failure state.
