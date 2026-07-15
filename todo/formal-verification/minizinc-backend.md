---
name: formal-verification-minizinc-backend
description: Evaluate MiniZinc for finite-domain, scheduling, allocation, and browser solving.
status: open
priority: low
area: reasoning
source: minizinc-js-follow-up-analysis
---

# Evaluate a MiniZinc backend

## Goal

Determine whether the official [`minizinc`](https://github.com/MiniZinc/minizinc-js)
JavaScript package should become CAVE's preferred second solver adapter after
Z3. The value to prove is not another way to solve the current scalar model;
it is a useful finite-domain and combinatorial profile for scheduling,
allocation, assignment, packing, and configuration problems, plus a browser
runtime that does not inherit Z3's `SharedArrayBuffer` deployment requirement.

MiniZinc is a modeling system rather than one solver. Its WebAssembly build can
route flattened models to engines including Gecode, Chuffed, CBC, and HiGHS.
That could cover constraint programming and mixed-integer optimization behind
one generated model, but it also introduces another language boundary and
backend-dependent semantics that CAVE must make explicit.

## Integration boundary

- Compile only validated `@cavelang/solver` models or a separately versioned
  finite-domain extension into generated `.mzn` plus JSON data.
- Keep generated identifiers stable and retain reverse maps for variables,
  constraints, objectives, CAVE evidence rows, and scenario inputs.
- Never accept raw MiniZinc, DataZinc, FlatZinc, parameter files, include paths,
  or solver flags from agents, MCP callers, or untrusted scenarios.
- Select the MiniZinc solver explicitly or through checked capabilities. Never
  silently switch engines after an unsupported model or solver failure.
- Record the MiniZinc version, selected solver and version, options, generated
  model digest, portable model digest, runtime profile, and limits.
- Keep `minizinc` optional and dynamically imported outside the knowledge
  kernel and ordinary CLI, MCP, and website startup.

The existing portable model remains the semantic source of truth. Do not make
MiniZinc source its durable or public representation. If arrays, indexed entity
sets, or global constraints are added, define their portable meaning and
capability negotiation before extending this adapter.

## Capability profile

Prove a bounded `finite-domain` profile with:

- Boolean, bounded integer, and finite-enum variables;
- indexed variables whose indices map to stable CAVE entity IDs;
- Boolean connectives, comparisons, and integer arithmetic;
- satisfaction and a single integer objective;
- selected global constraints with clear portable semantics, starting with
  `all_different`, cardinality, element/table, and cumulative scheduling;
- model enumeration capped by an explicit output limit; and
- deterministic result ordering or an explicit nondeterminism diagnostic.

Treat the following as separate capabilities rather than approximations:

- MiniZinc float range and precision are implementation-defined. Compile an
  exact CAVE rational only when a checked common scale converts the entire
  relevant expression to bounded integers without overflow; otherwise reject
  the model before solving.
- Weighted soft constraints compile to an explicit penalty objective. They are
  not advertised as MaxSMT and never derive weights from CAVE confidence.
- Lexicographic objectives require bounded, proved-safe encoding or staged
  solves that fix each proved optimum before optimizing the next objective.
- A feasible incumbent after timeout is `unknown`, not `optimal`.
- Counterexamples are claims about the declared bounded domains and generated
  model, not unbounded SMT proofs.

## Explanations and infeasibility

The JavaScript API exposes solve status, solutions, statistics, events, and
cancellation, but it does not expose a solver unsatisfiable core equivalent to
the Z3 adapter. MiniZinc's separate FindMUS tooling must not be assumed present
in the npm browser or Node runtime.

Evaluate a backend-neutral explanation fallback only when needed:

1. guard each named hard constraint with a stable Boolean selector;
2. prove the full selected set infeasible;
3. run a bounded deletion or QuickXplain search through repeated solves;
4. return `unknown` if any subset check is unknown or the explanation budget is
   exhausted; and
5. map the resulting conflict through the existing explanation and scenario
   provenance contracts.

Report whether the returned conflict is minimal and how many solver calls it
required. Do not label a generated conflict a native unsat core.

## Runtime and packaging experiments

Test Node and browser as different supported products:

- **Node:** the supported package entrypoint launches a separately installed
  native `minizinc` executable. Detect it without mutating `PATH`, verify the
  executable and solver versions, constrain temporary files and include paths,
  cancel the child process reliably, and return a precise unavailable result.
- **Browser:** self-host `minizinc-worker.js`, `minizinc.wasm`, and
  `minizinc.data`; dynamically load them only after capability selection; bound
  the worker pool; terminate cancelled or over-limit runs; and verify the
  existing GitHub Pages deployment without cross-origin isolation.

At analysis time, npm package `minizinc@4.4.6` was about 5.1 MB compressed and
18.0 MB unpacked, dominated by a 17.3 MB Wasm module plus a 0.5 MB data file.
Re-measure the pinned candidate rather than treating those observations as a
budget. Audit the package's MPL-2.0 obligations and the licenses and notices of
every distributed solver.

## Benchmark gate

Use workloads that exercise MiniZinc's distinct strengths:

- assign people with skills and availability to projects or shifts;
- schedule actions with dependencies, capacities, and time windows;
- choose compatible components under cardinality and exclusion constraints;
- allocate budgets through MiniZinc targeting HiGHS; and
- scale the architecture-choice fixture across many candidate services.

Compare Z3, MiniZinc with at least Gecode or Chuffed, MiniZinc targeting HiGHS,
and direct HiGHS where the model belongs to all profiles. Measure compilation,
cold and warm solve latency, memory, artifact transfer, cancellation latency,
proof status, reproducibility, explanation cost, and result equivalence.

## Decision gate

Adopt MiniZinc when representative finite-domain/global-constraint models are
materially clearer or faster than their Z3 encodings and both runtime profiles
can preserve CAVE's validation, provenance, limits, and result semantics.

Reject or defer it when the useful workload remains within the existing scalar
portable model, native Node installation is operationally unacceptable,
generated-model diagnostics cannot map back reliably, or browser weight does
not justify the feature. A rejected MiniZinc spike does not imply that a direct
HiGHS adapter should ship.

## Done when

- One solver-neutral finite-domain fixture compiles without MiniZinc types or
  source escaping above the adapter boundary.
- Stable CAVE entity IDs round-trip through indexed assignments and
  explanations.
- Exact rationals are either proved safe as scaled integers or rejected before
  invocation; no implicit float downgrade exists.
- Satisfied, optimal, unsatisfied, unbounded where relevant, cancelled, and
  unknown statuses map conservatively to the portable result union.
- Cancellation, timeout, worker/process termination, temporary-file cleanup,
  concurrency, enumeration, and output limits are tested.
- Browser assets are lazy and resolve from a packed CAVE package and the
  deployed playground without changing ordinary startup.
- Node reports missing or incompatible MiniZinc and solver installations
  clearly and records the executable versions it used.
- Generated diagnostics and optional bounded conflicts map to model
  declarations, evidence rows, and scenario inputs.
- Solver and transitive license obligations are documented and satisfied.
- Benchmarks decide whether MiniZinc ships and whether a direct HiGHS adapter
  still adds enough value to maintain separately.
