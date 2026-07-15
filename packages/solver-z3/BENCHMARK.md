# Z3 feasibility benchmark

Measured on 2026-07-15 on Linux x64 with `z3-solver` 4.16.0, both at
the project's minimum Node.js 22.18 runtime and the available Node.js 24.14
runtime. CI runs the full adapter and lifecycle suite on Node.js 22.

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

## Decision

Accept Z3 as an optional Node.js backend. It produces satisfying assignments,
lexicographic optima, weighted-soft optima, and tracked unsatisfiable cores;
exact decimals round-trip as rationals; actual deadlines return `unknown`;
simultaneous calls are queued; and explicit shutdown terminates workers.

Do not add it to `@cavelang/solver`, the CLI, MCP, or website dependency graph
by default. Cold start, roughly 34.5 MB installed size, and process-wide
threaded-Wasm state are material costs. A consumer should opt into
`@cavelang/solver-z3`, initialize once, reuse it, and close it only during
process shutdown. Browser shipping remains a separate decision gate.
