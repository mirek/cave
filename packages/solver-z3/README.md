# `@cavelang/solver-z3`

Optional Node.js adapter from CAVE's solver-neutral model to the official
`z3-solver` WebAssembly package. Importing this package is cheap: Z3's 34 MB
Wasm module is dynamically imported and initialized only when `create()` is
called.

| Task | Start here |
| --- | --- |
| Run a first model and close its runtime | [Quick start](#quick-start) |
| Manage shared runtime ownership, failures and limits | [Runtime contract](#runtime-contract) |
| Understand supported models and proof requirements | [Compilation semantics](#compilation-semantics) |
| Check the browser support boundary | [Browser delivery decision](#browser-delivery-decision) |
| Run the named workflow from the CLI | [Named workflow CLI fixture](#named-workflow-cli-fixture) |
| Investigate timeout and interrupt recovery | [Deadline responsiveness diagnostic](#deadline-responsiveness-diagnostic) |
| Investigate memory pressure and runtime recovery | [Memory recovery diagnostic](#memory-recovery-diagnostic) |

## Quick start

```ts
import { Model, Solve } from '@cavelang/solver'
import { create } from '@cavelang/solver-z3'

const model: Model.t = {
  schema: Model.schema,
  variables: [{ id: 'replicas', sort: 'int', min: 1, max: 20 }],
  constraints: [{
    id: 'capacity',
    expression: {
      kind: 'gte',
      left: { kind: 'variable', id: 'replicas' },
      right: { kind: 'literal', sort: 'int', value: 3 }
    }
  }],
  objectives: [{
    id: 'fewest-replicas',
    direction: 'minimize',
    expression: { kind: 'variable', id: 'replicas' }
  }]
}

const z3 = await create()
try {
  const result = await Solve.run(z3, model, {
    limits: { timeoutMs: 2_000 }
  })
  console.log(result)
} finally {
  await z3.close()
}
```

This example owns its runtime and closes it even when model validation or solving
throws. In a shared service, keep runtime ownership at the service lifecycle: an
individual request must not close the runtime used by other requests.

Use `Solve.run` or `Solve.runWithExplanation` for application requests. These
entry points validate options and limits, capture and validate the model, freeze
the submitted graph, negotiate capabilities and capture the adapter result.
The runtime's `solve` method is the low-level adapter interface: it queues the
supplied model for compilation and assumes that preparation has already happened.
Its targeted timeout and cycle checks do not replace model validation or protect
a directly supplied mutable model from changes while queued.

## Runtime contract

- `create()` initializes once and returns the same process runtime until it is
  closed. Long-lived CLI and MCP processes should retain that runtime.
- Solve requests enter an explicit FIFO queue. Z3's TypeScript/Wasm binding is
  not thread-safe, so simultaneous requests never run checks concurrently or
  share solver state accidentally.
  Feasibility, optimization and unsatisfiable-core checks release their owned
  solver/optimizer only after the operation settles. If both the operation and
  release fail, both errors survive in order, with the operation error as cause;
  neither an unprintable value nor a release error hides the original failure.
  A release failure alone is propagated unchanged. Each release is attempted
  once; this does not guarantee recovery from damaged native state.
- `close()` waits for queued checks, requests worker termination and awaits
  Node's worker exit acknowledgments before clearing Emscripten's pool. It is
  idempotent. Short-lived commands must call it before exit.
  Closing marks the runtime unavailable to new solves immediately, but existing
  queued work settles before worker termination begins. `close()` does not
  forcibly terminate an active native check; if that check never settles, close
  remains pending as well. The check timeout and shutdown therefore share the
  cooperative-cancellation boundary.
  If worker termination fails, shutdown still attempts every worker in that
  batch and awaits all attempts before rejecting. It retains the pool's message
  handlers; one failure is rethrown unchanged and multiple failures are grouped
  in an `AggregateError` whose message includes each failure diagnostic. A failed runtime shutdown remains failed on subsequent
  `close()` or `create()` calls.
  Pending cleanup messages retain their handlers until worker exit; shutdown
  does not assume they arrive within one timer turn. The pool can contain
  persistent workers, so shutdown does not wait for the running pool to become
  empty on its own.
  Calls to `create()` during shutdown wait for it to finish, then share one
  new runtime. They never receive the closing instance. Repeated calls to the
  old runtime's `close()` cannot clear the replacement.
- Every check receives Z3's internal timeout plus an independent wall-clock
  interrupt. After expiry, CAVE repeats the interrupt every 50 ms while the
  check remains pending and stops the timer when the check resolves or rejects.
  An exception from an interrupt request stays within the solve operation instead
  of escaping the timer callback. Cancellation retries continue, retaining the
  first interrupt failure without accumulating repeated errors. The helper waits
  for the native check to settle before reporting failure, so solver/optimizer
  cleanup cannot race pending work. If the check also rejects, its error and the
  first interrupt error are retained together, with the check error as cause.
  Their combined message includes both underlying diagnostics, so the public
  backend-error reason retains them after error conversion. Unprintable thrown
  values use a safe placeholder; later interrupt failures do not replace the first.
  Cancellation is cooperative: the timer does not impose a hard process deadline,
  and initialization, queue wait and model compilation are outside this check timer.
  A live regression times out an 80-variable pigeonhole model, then immediately
  solves a satisfiable Boolean model on the same runtime. It checks the returned
  assignment and preserves the earlier timeout result. This verifies recovery
  for that workload, not termination or recovery from every native stall.
  This adapter accepts `timeoutMs` in 1..2147483647; larger deadlines
  return `unknown` with a `backend-error` before compilation, preventing timer
  overflow from becoming an immediate interrupt. This adapter-specific bound
  does not change other adapters' portable limit contract.
  The portable memory limit is applied through Z3's process-wide
  `memory_max_size` parameter while requests are serialized.
- Preflight declaration and expression limits remain in `@cavelang/solver`.
  This adapter additionally enforces `maxOutputBytes` on the serialized result.
- A timeout, memory limit, interrupt, non-rational model value, or backend
  failure returns `unknown`; none can be reported as proof of infeasibility or
  optimality.

## Compilation semantics

Booleans, bounded integers, exact rationals, conditionals, arithmetic, and
hard constraints compile directly. A live truth-table regression checks negation,
conjunction, disjunction, implication, Boolean equality/inequality and conditional
selection for all four Boolean input pairs. It also checks a conditional whose
branches mix an exact real half with an integer, preserving the selected value.
Decimal strings are reduced by
`@cavelang/solver` and passed to Z3 as `bigint` numerator/denominator pairs,
never as JavaScript floating point. Finite enums use bounded integer codes and
are decoded through the domain's canonical lexical order, so declaration
reordering cannot change an unconstrained assignment.
Enum literal lookup uses a value-to-code map built once from each sorted domain
for the compilation call. This removes repeated linear domain scans while
retaining the sorted array for decoding assignments. The extra maps use space
proportional to enum members and are rebuilt for each request; domain mutation
and reordering cannot reuse stale codes. Empty strings, prototype-like names
and distinct Unicode spellings retain their exact member identities.

Expression compilation uses an explicit traversal stack and caches shared
subexpressions within one model. Models accepted with raised depth limits can
reach Z3 without recursive JavaScript call-stack exhaustion. Repeated operands
remain repeated operations, and compiled expressions never cross requests.
Wide conjunctions and disjunctions compile in groups of at most 1,024 operands,
preserving every operand through associativity. This avoids JavaScript argument
limits in both the adapter and the Z3 binding, including for expressions within
the default node budget.
Generated variable-domain bounds are also submitted in batches of at most
1,024 assertions, for both feasibility and optimization. Raising the variable
limit therefore does not create one unbounded JavaScript argument list. Large
models may also need an explicit `maxNumericDigits` increase for their aggregate
bound and literal digits; raising the variable limit does not raise that budget.

Named hard constraints use tracked Boolean literals, so an unsatisfiable core
maps back to portable constraint IDs. After optimization proves infeasibility,
a separate tracked feasibility check extracts the optional core. That check
has its own configured timeout; if it returns no infeasibility proof, the
original result retains its proof with no core. A live regression checks the
same stable core IDs through both feasibility and optimization. Trackers use fresh Z3 symbols to avoid
collisions with user variable names; requesting a core cannot add a constraint
on a user variable through a shared symbol. Objective declaration order is Z3's
lexicographic order. Explicit weighted soft constraints form the final,
lowest-priority objective; their weights are never inferred from CAVE belief
confidence. A live tradeoff regression minimizes `x` and `y` under `x + y >= 10`
with both variables bounded to 0..10. Reversing objective order switches the
assignment from `(0, 10)` to `(10, 0)`; a weight-1,000,000 preference for `x = 5`
cannot override either explicit priority. Returned objective values retain
declaration order.
`Solve.run` charges soft weights to the model's aggregate `maxNumericDigits`
allowance before exact validation and backend invocation. Compilation reduces each weight and passes its
`numerator/denominator` text directly to Z3; it does not expand repeating decimals
or convert weights to JavaScript numbers. A real-backend regression swaps two
nonterminating rational weights that collapse to the same binary64 value and
verifies that the chosen Boolean follows the stronger exact weight both ways.
Fraction formatting copies the normalized components; exact reduction and native
optimization remain separate costs. Numeric preflight is not a wall-clock bound,
and the check timer does not cover compilation.

An `optimal` result requires each explicit objective's lower and upper bounds
to be the same finite rational, attained by the returned assignment. This check
uses exact arithmetic for every lexicographic objective. Unbounded objectives,
unattained strict bounds, or a model that does not attain the proved bound
return `unknown` with reason `indeterminate`, never a proof of optimality.

See [BENCHMARK.md](BENCHMARK.md) for artifact, initialization, solve, memory,
packaging, and lifecycle measurements. The spike accepts Z3 for optional
Node.js use. Browser delivery remains deferred because threaded Wasm requires
`SharedArrayBuffer`, cross-origin isolation headers, and separate worker asset
handling.

## Browser delivery decision

The supported browser profile is deliberately **no in-browser solver**. The
GitHub Pages playground remains query-only and never imports this package,
fetches Z3 Wasm, or exposes a solver control that could fail after startup.
CI scans the built website for Z3 modules and assets, while packed-artifact
smoke tests execute the optional Node workflow and verify its backend version
and clean process exit. Browser support may be reconsidered only with explicit
cross-origin-isolation deployment, capability detection, worker cancellation,
asset URL, license, and failure-state tests; it will not silently fall back to
a remote solver.

## Named workflow CLI fixture

The optional package also ships one allowlisted architecture-decision fixture
that exercises all four workflow operations without accepting model files,
raw expressions, or SMT-LIB:

```sh
cave-solver-workflow architecture feasibility --team-size 10 --deployment-frequency 6
cave-solver-workflow architecture optimization --team-size 10 --deployment-frequency 6
cave-solver-workflow architecture counterexample
cave-solver-workflow architecture sensitivity --team-size 10 --from 1 --to 12
```

Inputs and sample ranges are typed and bounded before Z3 loads. Every command
uses the workflow API, so model validation, capability negotiation, limits,
deterministic tie-breaking, and `unknown` semantics cannot be bypassed. The
JSON output is a versioned workflow/explanation report. The fixture's relative
cost formula is deliberately illustrative and does not use belief confidence.
Argument errors return exit code 2. Runtime startup, workflow execution and
shutdown failures return code 1 with empty stdout and a diagnostic on stderr.
If execution and shutdown both fail, the diagnostic retains the execution error
followed by the shutdown error. A successful report is emitted only after the
owned runtime closes successfully. Programmatic `runWorkflowFixture` calls
return the same output fields and close only runtimes created by the fixture;
caller-supplied adapters remain caller-owned. Exception formatting is guarded:
values whose message or string conversion throws produce
`[unprintable thrown value]`, so diagnostic rendering cannot skip owned cleanup
or replace the error result. Backend-error diagnostics use the same fallback.

All four operations accept `--max-explanation-bits <positive integer>` to set
the local constraint-evaluation size budget (default: 1,000,000). The value is
validated before loading Z3 and travels in the report's resolved limits.
For example, `cave-solver-workflow architecture feasibility --max-explanation-bits 2000000`
allows a larger local evaluation than the default. Exceeding the budget leaves
the backend outcome intact and marks affected constraints indeterminate; retry
with a larger value to request a fresh evaluation. This conservative fraction-size
budget is separate from `--timeout-ms` and backend memory limits.
All four operations also accept `--max-explanation-work <positive integer>`
(default: 10,000,000) for cumulative estimated-bit charges within each report.
It is validated before Z3 starts and recorded with the resolved limits. Exhaustion
marks affected local evaluations indeterminate while preserving the backend result;
use a larger allowance for a fresh report requiring more distinct arithmetic.
This counter does not cover every report phase or guarantee elapsed time.
The CLI accepts `--timeout-ms` only in Z3's supported range, 1..2147483647.
Larger values fail as argument errors before adapter startup, rather than
producing a backend-error workflow report. Both endpoints of the range remain
valid, and a corrected invocation can run normally.

The real-adapter suite also checks sensitivity batch preflight and provenance.
A later sample that exceeds the generated-model digit budget is rejected before
any Z3 submission. Raising the limit solves both distinct sample models, reports
their exact assignments and the observed transition, and retains the authored
model's digest in the batch, point and explanation reports. Generated sample
models have their own distinct digests; they do not replace source identity.

## Deadline responsiveness diagnostic

Run `node scripts/z3-deadline-probe.mjs` from the repository root to exercise
three fresh processes, each issuing ten 1 ms pigeonhole requests on one runtime
and following every timeout result with a satisfiable recovery request. The
parent imposes a 15-second allowance per process, retains partial event output
and terminates an overrun. This is a diagnostic harness limit, not an adapter
guarantee; the probe exits unsuccessfully if any process fails or overruns.

A Node 26 suite observed a 208.5-second timeout test. The initial bounded probe
reproduced a stall in one of three processes; the other 25 requests completed in
118–191 ms. Retrying interrupts while native work remains pending then completed
all 30 requests and recovery checks on each supported Node major: 118–220 ms on
Node 24.21.0 and 113–237 ms on Node 26.8.1. These complete-call times include
preparation. [Partial reproduction events and subsequent results](../../benchmarks/z3-deadline-retry-review.json)
retain the failure evidence and source hashes. A deterministic test verifies
repeated cancellation after a check ignores the first interrupt, and timer
cleanup after settlement. The precise native cause remains unproven; successful
retries do not establish a hard elapsed-time bound.

A later [current-source checkpoint](../../benchmarks/z3-deadline-current-review.json)
also completes all 30 timeout/recovery pairs per major and closes all three
runtimes: 112–220 ms per complete call on Node 26.8.1 and 114–226 ms on Node
24.21.0. The probe now fingerprints every solver and Z3 adapter TypeScript
source, including the deadline helper and error formatting, plus its own source
and the lockfile. Earlier reports retain their original narrower fingerprint
scope; the historical stalled run remains evidence for the unresolved native
cause. These finite runs do not guarantee recovery from every native stall.

## Memory recovery diagnostic

Run `pnpm --filter @cavelang/solver-z3 test:memory-stress` to exercise ten
memory-limit failures followed by optimization of 3,000 bounded variables in
the same runtime, with forced garbage collection during asynchronous checks.
The command enables `--expose-gc`, logs environment and phase metadata, and
verifies each recovery's complete assignment and exact optimum. Assertion
failures exit unsuccessfully after worker cleanup. This diagnostic is separate
from the ordinary test suite and does not establish recovery from every fatal
Wasm error.

A [current-source checkpoint](../../benchmarks/z3-memory-current-review.json)
passes all ten default cycles on Node 26.8.1 and 24.21.0: each 1 MiB memory-limit
failure is followed by the exact optimum of 3,000 and validation of all 3,000
assignments in the same runtime. Both processes exit cleanly after runtime
closure. The record includes phase output and solver/adapter source fingerprints.
This checkpoint does not rerun `--large` or cover every fatal native error.

Add `--large` to run three cycles that insert the original 75,000-variable
domain-bound contradiction in both feasibility and optimization modes between
each memory-limit failure and the 3,000-variable recovery probe. The large
fixture explicitly permits 75,000 variables and 150,002 numeric digits: two
one-digit bounds per variable, one constraint literal and an optional objective
literal. These diagnostic settings let the intended backend stress run reach Z3
without changing production validation defaults. Large phases
log the complete result, wall time, and Node process memory counters. These
counters describe process memory, not Z3's internal allocation accounting.
The diagnostic submits subsequent requests before asserting large-phase
results, preserving evidence of whether the same runtime remains usable.
The runtime CI matrix runs the large diagnostic on each configured runtime/OS
entry. Each large solve has a 120-second budget, and the CI step has a
15-minute timeout to bound native hangs across all three cycles. The larger
budget accommodates shared-runner performance: Windows CI exceeded the previous
30-second feasibility deadline while the following optimization and recovery
still returned the expected results. This diagnostic checks cleanup correctness;
it does not impose a 30-second performance requirement. Workload size, forced
collection frequency and exact result assertions remain unchanged.

The adapter defers native reference cleanup while its asynchronous feasibility
or optimization check runs, draining releases once the native promise settles,
including on rejection. The binding's garbage-collection finalizers otherwise
call native reference decrements outside its check mutex, allowing AST deletion
to overlap the solver thread. The large diagnostic exposed both an incorrect
recovery optimum (`0` instead of `3000`) and a memory-access crash in that
cleanup path. The guard belongs to CAVE's private Z3 instance; it changes no
global JavaScript finalizer behavior and keeps synchronous cleanup immediate.
Queued releases are attempted in order even when an earlier release throws.
A lone cleanup failure propagates unchanged; multiple failures are retained in
an `AggregateError`. If the native check also failed, its error comes first and
remains the cause, followed by cleanup failures in release order. Unprintable
thrown values cannot interrupt diagnostic formatting or skip later releases.
Drained releases are not replayed by a subsequent check. This preserves cleanup
attempts and error ownership; it does not promise that damaged native state is
recoverable after a failed release.
A [post-fix native recovery checkpoint](../../benchmarks/z3-cleanup-recovery-review.json)
passes three large cycles on each supported Node major under forced garbage
collection, retaining the 75,000-variable checks and exact recovery optimum.
It verifies this workload and clean process exit, not arbitrary native failures.

Process lifecycle tests launch fixtures using native paths converted with
`fileURLToPath`, so Windows drive letters and percent-encoded checkout names
reach Node correctly. These tests exercise worker shutdown and runtime reopening
in a separate process.
