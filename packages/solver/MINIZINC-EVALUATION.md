# MiniZinc backend evaluation

Evaluated 2026-07-15 against the official
[`minizinc@4.4.6`](https://www.npmjs.com/package/minizinc) package and its
[`MiniZinc/minizinc-js`](https://github.com/MiniZinc/minizinc-js) source.

## Decision

Defer a CAVE MiniZinc adapter. Do not add the npm dependency, publish an
adapter package, or copy its browser assets into the website yet.

MiniZinc is attractive for scheduling, assignment, packing, and other models
with indexed variables and global constraints. Those constructs are not in
the current `cave.solver/model@1` contract. An adapter built now would either
duplicate Z3 over the existing scalar model or introduce a MiniZinc-specific
public model, making generated MiniZinc source the accidental semantic
boundary. Neither result earns the runtime and packaging cost.

This is a deferred adoption decision, not a rejection of MiniZinc. Revisit it
after a concrete CAVE workflow justifies a solver-neutral finite-domain model.

## Candidate inspected

The official package supports two materially different products:

| Profile | What the package does | Consequence for CAVE |
|---|---|---|
| Node.js | Spawns a separately installed native `minizinc` executable. | CAVE would need installation/version discovery and its own isolating process boundary. |
| Browser | Runs MiniZinc and bundled solvers in ordinary Web Workers. | It avoids Z3's `SharedArrayBuffer` requirement, but CAVE must self-host and lazily load a large runtime. |

`npm pack minizinc@4.4.6 --json` reported:

| Artifact | Bytes |
|---|---:|
| npm tarball | 5,054,594 |
| unpacked package | 18,040,551 |
| `minizinc.wasm` | 17,309,395 |
| `minizinc.data` | 495,267 |
| `minizinc-worker.js` | 162,057 |

The package exports the three browser assets explicitly and selects a native
Node entrypoint through conditional exports. Its browser runtime defaults to
two workers, terminates the worker used by a solve, replenishes the pool, and
terminates a running worker on cancellation. The Node runtime writes virtual
files to a temporary directory, spawns the executable, sends `SIGINT` on
cancellation, and removes the directory after process exit.

No browser or MiniZinc asset is needed by the current CAVE CLI, MCP server, or
website, so retaining a zero-byte default cost is preferable.

## Semantic fit

### Existing portable model

The existing portable model already covers Boolean logic, bounded integers,
exact rationals, finite enums, weighted soft constraints, lexicographic
objectives, and provenance. Z3 implements that profile and supplies tracked
unsatisfiable cores.

MiniZinc would add distinct value only after the portable contract defines at
least indexed variables and selected global constraints such as
`all_different`, table/element, cardinality, and cumulative scheduling. That
schema needs backend-neutral validation, canonical identity, capability
negotiation, deterministic result ordering, and explanation mappings before
an adapter is appropriate.

### Exact arithmetic

MiniZinc floats are not a substitute for CAVE's exact rational semantics.
Exact rationals could be compiled only after a checked common-scale transform
proves that every affected coefficient, bound, intermediate expression, and
objective fits the selected integer solver's range. The current model does
not define that transform. Silently compiling exact values to `float` is
therefore forbidden.

### Infeasibility explanations

The JavaScript API reports solve status, solutions, statistics, diagnostics,
and cancellation, but exposes no native unsatisfiable core. FindMUS is a
separate tool and is not part of the npm browser/Node API.

A future adapter may implement a bounded deletion or QuickXplain fallback
with stable constraint selectors. It must label the result as a generated
conflict, report whether it is minimal and how many solves it used, and return
`unknown` when any subset check or the explanation budget is inconclusive.

### Status mapping

`SATISFIED`, `OPTIMAL_SOLUTION`, and `UNSATISFIABLE` have conservative CAVE
counterparts. `UNKNOWN`, `ERROR`, `UNBOUNDED`, and `UNSAT_OR_UNBOUNDED` need
structured `unknown` reasons unless a future portable result schema gives
them a stronger explicit meaning. A feasible incumbent at a time limit must
remain `unknown`, never `optimal`.

## Runtime and security findings

The upstream API accepts raw model/DataZinc text and an open-ended option map.
A CAVE integration must expose neither. It must accept only a validated
portable model, generate fixed files internally, select a checked solver, and
pass an allowlisted option set.

The official Node wrapper supplies cancellation and eventual temporary-file
cleanup, but it does not enforce CAVE's working-memory ceiling or isolate the
native process from arbitrary filesystem includes on its own. A future Node
adapter therefore needs a CAVE-owned child process or worker supervisor that:

- resolves an explicit executable without mutating `PATH`;
- verifies MiniZinc and selected-solver versions before accepting work;
- uses a private temporary directory and generated files only;
- enforces wall-clock, memory, output, concurrency, and process-tree limits;
- waits for termination and cleanup before resolving; and
- maps forced termination to a structured `unknown` result.

The browser build has the better isolation shape, but its worker pool and
18 MB unpacked payload still need packed-package URL tests, a deployment asset
budget, explicit solver/version discovery, cancellation tests, and proof that
ordinary site startup never fetches the assets.

## Licensing

The JavaScript package is MPL-2.0 and its npm tarball contains that license.
Its WebAssembly distribution also embeds MiniZinc and solver code. Before CAVE
redistributes those assets, the release process must inventory each bundled
solver, preserve all required notices and source-offer obligations, and verify
that the packed CAVE artifact contains them. No assets are redistributed by
the current decision.

## Gate result

| Gate | Result |
|---|---|
| Distinct finite-domain workload represented by a portable CAVE schema | Not met; `model@1` has no indexed variables or global constraints. |
| Better clarity or performance than the equivalent Z3 model | Not benchmarkable without that shared semantic model. |
| Exact-number semantics preserved | Not met; a checked integer-scaling transform is not defined. |
| Provenance and diagnostics round-trip | Design is feasible through generated identifier maps, but unproven for global constraints. |
| Node runtime satisfies CAVE limits | Not met by the upstream wrapper alone. |
| Browser delivery satisfies the deployment budget | Not decided; runtime hardening owns this wider browser gate. |
| Distribution licenses are complete | Requires a transitive solver audit before browser assets ship. |

The early gates fail independently of solver speed, so adding a benchmark-only
adapter would create maintenance without resolving the decision. The direct
HiGHS evaluation may proceed for the already recognized linear subset; it
does not depend on pretending MiniZinc has shipped.

## Revisit criteria

Reopen MiniZinc evaluation only when all of these inputs exist:

1. a real CAVE scheduling, assignment, packing, or configuration workflow;
2. a solver-neutral finite-domain schema with canonical identity and limits;
3. equivalent Z3 and MiniZinc encodings of the same representative fixtures;
4. a Node supervisor and browser harness that enforce the runtime contract;
5. packed-artifact and GitHub Pages tests for lazy worker/Wasm/data URLs; and
6. a complete license-and-notice manifest for the selected distributed solvers.

At that point benchmark Gecode or Chuffed against Z3, and MiniZinc-to-HiGHS
against direct HiGHS where the model is linear. Measure cold/warm compile and
solve latency, peak memory, transfer size, cancellation latency,
reproducibility, result equivalence, and generated-conflict cost.

## Reproduction notes

The evaluation used the following read-only checks:

```sh
npm pack minizinc@4.4.6 --json
tar -xzf minizinc-4.4.6.tgz
sed -n '1,240p' package/package.json
sed -n '1,620p' package/types/index.d.ts
command -v minizinc
```

The package manifest, public type declarations, Node wrapper, browser wrapper,
worker lifecycle, asset sizes, and license payload were inspected directly.
No native `minizinc` executable was present in the evaluation environment, so
no native timing is reported as though it were a comparable benchmark.
