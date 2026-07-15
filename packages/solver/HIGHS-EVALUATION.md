# Direct HiGHS backend evaluation

Evaluated 2026-07-15 on Linux x64 with Node.js 24.14 against the maintained
[`highs@1.14.2`](https://www.npmjs.com/package/highs) package, which embeds
HiGHS 1.14.2 as WebAssembly.

## Decision

Defer a CAVE HiGHS adapter. Do not add the npm dependency or publish an
adapter package yet.

HiGHS clears the performance and package-size gate decisively for linear and
mixed-integer workloads. It does not clear CAVE's semantic or execution gates:
the wrapper accepts CPLEX LP text as binary64 coefficients, solves
synchronously, exposes no cancellation boundary, and can grow its Wasm heap
to 2 GiB without a configurable memory ceiling. `cave.solver/model@1` instead
defines exact rationals and requires every adapter to honor the requested
working-memory limit. Returning a floating-point solution as an exact CAVE
rational or marking a numerically optimal result as an exact proof would be a
contract violation.

This is a deferred adoption decision, not a rejection of HiGHS. It is the
best measured candidate for large LP/MIP models once CAVE has an isolated
runtime and an explicit approximate-numeric result contract or a proved-safe
exact compilation profile.

## Candidate inspected

The npm package is a small CommonJS loader around one Emscripten module. Its
public API accepts a CPLEX LP string plus an allowlisted subset of HiGHS
options and returns status, objective, column, and row data.

Registry and packed-artifact measurements:

| Artifact | Bytes |
|---|---:|
| npm tarball | 1,097,060 |
| unpacked package | 3,171,636 |
| `highs.wasm` | 3,078,627 |
| gzip-compressed `highs.wasm` | 1,065,194 |
| JavaScript loader | 68,966 |

For comparison, the accepted `z3-solver@4.16.0` package is 34,533,499 bytes
unpacked and its Wasm artifact is 33,704,614 bytes. HiGHS therefore has a real
delivery advantage rather than a marginal benchmark win.

## Representative benchmark

The comparison used the same portable linear models for Z3 and generated LP
text for HiGHS. All coefficients in these fixtures are integers; no random
instances or toy single-row models were used.

| Workload | Variables | Constraints | HiGHS first | HiGHS warm mean | Z3 first | Objective comparison |
|---|---:|---:|---:|---:|---:|---|
| Portfolio allocation | 120 real | 13 | 113.51 ms | 5.75 ms | 876.65 ms | Both `30200` |
| Service capacity | 240 integer | 24 | 257.87 ms | 120.20 ms | 10,271.52 ms | HiGHS `5256`; Z3 returned timeout `unknown` |
| Assignment | 400 binary-bounded integer | 40 | 49.01 ms | 37.05 ms | 2,794.96 ms | Both `46` |
| Scaled architecture trade-off | 300 binary-bounded integer | 151 | 11.15 ms | 10.32 ms | 974.60 ms | Both `750` |

HiGHS initialized in 98.18 ms. Its benchmark process added about 54.8 MB RSS.
The separate Z3 runs initialized in 753–838 ms and added 119.6–188.2 MB RSS.
HiGHS used one thread, disabled console output, set both MIP gap tolerances to
zero, and received a 10-second solver time limit. Warm HiGHS figures are the
mean of five runs after the first. Z3 figures are the first check after one
runtime initialization; the service-capacity result demonstrates the deadline
rather than pretending an incomplete incumbent is optimal.

The three completed shared fixtures have equal objective values. That is
useful compatibility evidence, but it is not a proof that binary64 HiGHS has
implemented the exact rational feasible set.

## Semantic fit

### Deterministic linear compilation

The existing `Linear.model` preflight recognizes non-strict affine
constraints and affine objectives while rejecting Boolean/enum variables,
soft constraints, strict inequalities, logic, and nonlinear expressions. A
direct adapter can generate stable identifiers such as `v0` and `c0` from
sorted portable IDs and retain reverse maps, so arbitrary CAVE identifiers
never enter LP syntax. Unsupported constructs can fail before the wrapper is
loaded.

That compiler shape is straightforward. The blocker is what its numbers and
results mean, not identifier escaping.

### Exact numbers

The portable model normalizes every decimal to an exact rational before an
adapter runs. The HiGHS wrapper parses LP coefficients and returns assignments
as JavaScript `number`. Converting those numbers back to decimal strings would
record rounded binary64 values as exact rationals.

A future adapter needs one of two explicit contracts:

1. an approximate-linear model/result schema with declared feasibility,
   integrality, and objective tolerances, including non-proof status names; or
2. a restricted exact profile that proves integer scaling, coefficient and
   intermediate bounds, integrality, and exact post-validation for every
   assignment and optimum certificate it reports.

The current result schema has neither. Tolerance belongs in the semantic
model, not as an undocumented adapter constant.

### Objectives and explanations

The wrapper accepts one LP objective. Portable objectives are lexicographic.
Sequential solves would have to constrain each prior optimum before solving
the next objective; doing that soundly requires the same numeric contract that
is currently missing.

HiGHS reports infeasibility but the JavaScript wrapper exposes no IIS or
infeasibility certificate API. An adapter must not advertise `unsat-cores`.
`Unbounded`, `Primal infeasible or unbounded`, time/iteration limits, and
solver errors map conservatively to `unknown` under the current CAVE result
vocabulary.

## Runtime and security findings

Generated LP text can keep raw models and solver flags away from untrusted
callers. Model-size and output-size limits can also be checked before and
after the call. The upstream execution boundary still fails two required
operational limits:

- `solve()` is synchronous. A JavaScript timer cannot interrupt LP parsing or
  a stuck Wasm call; HiGHS' `time_limit` is an internal solve limit, not a host
  cancellation boundary.
- The generated loader's heap-growth ceiling is 2,147,483,648 bytes. The API
  exposes no way to reduce it or enforce CAVE's default 512 MiB
  `maxMemoryBytes` request.

An adapter therefore needs a CAVE-owned worker or process supervisor that can
terminate the entire runtime and enforce memory outside the Wasm module. Node
worker `resourceLimits` alone are not sufficient evidence because Wasm linear
memory is external to the JavaScript heap limit. The runtime/browser work
package owns this shared isolation problem.

## Gate result

| Gate | Result |
|---|---|
| Existing portable linear subset | Met; deterministic recognition already ships. |
| Representative advantage over Z3 | Met; 7.7–87× faster first solves in completed fixtures, much smaller package, and one Z3 timeout. |
| Shared objective equivalence | Met for the three fixtures Z3 completed; insufficient to establish exact semantics. |
| Exact-number and proof semantics | Not met; the public boundary is binary64 and CAVE has no approximate result contract. |
| Lexicographic objectives | Not met soundly through the single-objective wrapper. |
| Unsupported constructs rejected before load | Design is straightforward through existing linear preflight, but no adapter is shipped. |
| Wall-clock cancellation | Not met by the synchronous wrapper alone. |
| Working-memory ceiling | Not met; the Wasm heap may grow to 2 GiB. |
| Distribution license | Met; the npm package carries the MIT license. |

Performance justifies revisiting direct HiGHS. It does not justify weakening
the portable contract now.

## Revisit criteria

Adopt a direct adapter only when all of these conditions hold:

1. the portable API names approximate LP/MIP semantics and tolerances, or an
   exact restricted profile is specified and post-validated;
2. a worker/process supervisor enforces deadline, memory, output, and cleanup
   limits around synchronous Wasm;
3. lexicographic objective behavior is defined without silently rounding a
   previous optimum;
4. shared fixtures verify assignments, feasible sets, objectives, status
   mapping, and unsupported-model rejection;
5. packed Node and browser tests resolve `highs.wasm` lazily without changing
   ordinary CLI, MCP, or website startup; and
6. recorded reports identify HiGHS, wrapper, numeric profile, and tolerance
   versions explicitly.

## Reproduction notes

The package measurements came from the npm registry metadata and the packed
`highs@1.14.2` tarball. The runtime inspection covered `README.md`,
`types.d.ts`, the generated loader, its heap-growth implementation, the Wasm
asset, and the included MIT license.

The benchmark generated four deterministic models described in the table,
ran HiGHS with `threads: 1`, `time_limit: 10`, `mip_rel_gap: 0`, and
`mip_abs_gap: 0`, then ran the same `Model.t` values through
`@cavelang/solver-z3`. RSS was measured in separate processes. Objective
values were compared only when both backends returned `optimal`.
