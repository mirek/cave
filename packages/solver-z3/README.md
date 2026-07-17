# `@cavelang/solver-z3`

Optional Node.js adapter from CAVE's solver-neutral model to the official
`z3-solver` WebAssembly package. Importing this package is cheap: Z3's 34 MB
Wasm module is dynamically imported and initialized only when `create()` is
called.

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
const result = await Solve.run(z3, model, {
  limits: { timeoutMs: 2_000 }
})
await z3.close()
```

## Runtime contract

- `create()` initializes once and returns the same process runtime until it is
  closed. Long-lived CLI and MCP processes should retain that runtime.
- Solve requests enter an explicit FIFO queue. Z3's TypeScript/Wasm binding is
  not thread-safe, so simultaneous requests never run checks concurrently or
  share solver state accidentally.
- `close()` waits for queued checks, terminates all Emscripten workers, and is
  idempotent. Short-lived commands must call it before exit.
- Every check receives Z3's internal timeout plus an independent wall-clock
  interrupt. The portable memory limit is applied through Z3's process-wide
  `memory_max_size` parameter while requests are serialized.
- Preflight declaration and expression limits remain in `@cavelang/solver`.
  This adapter additionally enforces `maxOutputBytes` on the serialized result.
- A timeout, memory limit, interrupt, non-rational model value, or backend
  failure returns `unknown`; none can be reported as proof of infeasibility or
  optimality.

## Compilation semantics

Booleans, bounded integers, exact rationals, conditionals, arithmetic, and
hard constraints compile directly. Decimal strings are reduced by
`@cavelang/solver` and passed to Z3 as `bigint` numerator/denominator pairs,
never as JavaScript floating point. Finite enums use bounded integer codes and
are decoded through the domain's canonical lexical order, so declaration
reordering cannot change an unconstrained assignment.

Named hard constraints use tracked Boolean literals, so an unsatisfiable core
maps back to portable constraint IDs. Objective declaration order is Z3's
lexicographic order. Explicit weighted soft constraints form the final,
lowest-priority objective; their weights are never inferred from CAVE belief
confidence.

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
