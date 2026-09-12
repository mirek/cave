# Z3 feasibility benchmark

## Current macOS measurements

Measured on 2026-09-08 on macOS arm64 with `z3-solver` 5.2.0, whose embedded
backend reports `Z3 5.1.0.0`. Each Node version ran in a separate process,
sequentially, against the current worktree after the solver input-capture and
explanation-ownership changes. The fixture uses `Solve.run`; it does not measure
explanation construction. Each run completed one first optimized check and 25
warm checks, all returning `optimal`, then closed the runtime and exited.

| Measurement | Node 24.16.0 | Node 26.5.0 |
|---|---:|---:|
| Cold Wasm initialization | 69 ms | 75 ms |
| First optimized check | 85.69 ms | 95.06 ms |
| Warm mean | 5.16 ms | 5.15 ms |
| Warm p50 | 5 ms | 4.92 ms |
| Warm p95 | 6.09 ms | 5.97 ms |
| RSS before initialization | 149,045,248 bytes | 151,977,984 bytes |
| RSS after 26 checks | 284,917,760 bytes | 248,299,520 bytes |
| Peak process RSS | 295,780,352 bytes | 256,851,968 bytes |

Both runs measured 25 installed dependency files totaling 35,820,846 bytes,
including 34,938,413 bytes of Wasm. The sum of individually gzip-compressed files
was 8,066,680 bytes. This measures installed package contents, not an npm tarball.

These are single-process observations with 25 warm samples each, not a latency
budget or a controlled comparison against the earlier implementation. Platform,
dependency version, cache state and concurrent machine activity can affect the
results; the Linux measurements below are not a performance baseline for this
Mac. Use `pnpm --filter @cavelang/solver-z3 benchmark` to reproduce the fixture.

## Earlier Linux measurements

Measured on 2026-07-15 on Linux x64 with `z3-solver` 4.16.0, both at
the former minimum Node.js 22.18 runtime and the available Node.js 24.14
runtime. These figures describe that measured dependency version, not the
current adapter's performance. The runtime CI matrix now runs portable solver
and adapter suites plus the large forced-GC cleanup diagnostic on its pinned
Node 24 and 26 / Linux, macOS, and Windows entries.

The fixture optimizes an exact architecture-choice model with a finite enum,
bounded integer, exact-real cost, conditional constraint, and lexicographic
objective. Warm latency is 25 sequential solves through one initialized
runtime.

| Measurement | Node 22.18.0 | Node 24.14.0 |
|---|---:|---:|
| Installed `z3-solver` files | 34,533,499 bytes | 34,533,499 bytes |
| Shipped Wasm | 33,704,614 bytes | 33,704,614 bytes |
| Sum of individually gzip-compressed package files | 7,762,833 bytes | 7,762,833 bytes |
| Cold Wasm initialization | 394 ms | 414 ms |
| First optimized check after initialization | 282.75 ms | 337.89 ms |
| Warm mean | 7.62 ms | 8.79 ms |
| Warm p50 | 7.32 ms | 7.45 ms |
| Warm p95 | 10.83 ms | 14.17 ms |
| RSS before initialization | 147,804,160 bytes | 138,227,712 bytes |
| RSS after 26 checks | 250,896,384 bytes | 225,439,744 bytes |
| Peak process RSS | 256,487,424 bytes | 227,479,552 bytes |

The installed-size measurement covers the 23 files shipped by `z3-solver`.
Its npm tarball is about 7.8 MB, consistent with the gzip measurement. The
adapter package was packed with compiled declarations/runtime files, installed
with its published dependencies in a clean consumer, solved a model, called
`close()`, and exited without a worker hang. `scripts/benchmark.ts` reproduces
the local measurements.

Each successful JSON summary identifies the installed `z3-solver` package
version separately from its embedded backend version, the canonical fixture
model digest, and the number of verified checks. Keep these fields with saved
measurements so results can be matched to the dependency and workload used.

The current benchmark verifies every answer, not only its status: optimality
must be proved, the selected architecture must be `monolith`, team size must be
12, and both assigned monthly cost and the sole objective value must equal the
exact rational `321/4` (80.25). A wrong answer fails without publishing timing
statistics. Verification runs after each timed solve interval. The measurements
above predate this stronger answer assertion and retain their original status-only
verification scope.

The benchmark closes its runtime in a `finally` block after initialization,
including when the first check or a warm check returns an unexpected status,
or a solve throws. Failed runs retain their diagnostic and do not emit a
successful measurement summary.

## Decision

Accept Z3 as an optional Node.js backend. It produces satisfying assignments,
lexicographic optima, weighted-soft optima, and tracked unsatisfiable cores;
exact decimals round-trip as rationals; actual deadlines return `unknown`;
simultaneous calls are queued; and explicit shutdown terminates workers.

Do not add it to `@cavelang/solver`, the CLI, MCP, or website dependency graph
by default. Cold start, roughly 35.8 MB installed size in the current measurement, and process-wide
threaded-Wasm state are material costs. A consumer should opt into
`@cavelang/solver-z3`, initialize once, reuse it, and close it only during
process shutdown. Browser shipping remains a separate decision gate.
