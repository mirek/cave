# @cavelang/loop

`cave-loop` — the active-reconstruction agent layer over the CAVE graph
(spec §18, **non-normative**). Implements Ji et al.'s Algorithm 1
(*Memory is Reconstructed, Not Retrieved*, 2026) as a functional loop, per
the spec's Cue–Tag–Content mapping (§11.3).

The agent layer is deliberately outside the language specification:
reconstruction is a *policy* over the graph, so the policy can evolve or
be swapped without spec churn. Everything here is injectable.

```ts
import { memoryStoreOfText, reconstruct, heuristicPolicy } from '@cavelang/loop'

const store = memoryStoreOfText(knowledge)
const { claims, trace } = reconstruct(store, heuristicPolicy(), ['reject-valid-tokens'])
```

The LLM-driven policy (spec §18) runs the same loop asynchronously,
with any shell-agent command deciding select/stop:

```ts
import { llmPolicy, reconstructAsync, shellComplete } from '@cavelang/loop'

const policy = llmPolicy(shellComplete(`claude -p`), { query: 'why are valid tokens rejected?' })
const { claims } = await reconstructAsync(store, policy, ['reject-valid-tokens'])
```

## Pieces

- **`CaveStore`** — the store contract the language guarantees the agent
  (§18): forward reads via the subject index, *named* inverse reads via
  the object index plus `inverse_of()`, current-belief resolution via
  claim keys, topic expansion via `CONTAINS` in both directions.
  `memoryStore` implements it dependency-free (and mirrors `@cavelang/store`'s
  traversal defaults: negated and `@ 0%` facts are not edges);
  `sqliteStore` adapts an open `@cavelang/store` database to the same
  shape — the adapter behind the MCP `cave_reconstruct` tool and the CLI
  `cave reconstruct` command.
- **`Policy`** — select / score / stop, injected into `reconstruct`. The
  loop routes by expanding a cue's claims (content) and offering scored
  neighbors from forward, inverse and topic edges. `AsyncPolicy` is its
  awaited twin, run by `reconstructAsync` — same algorithm, same trace.
- **`heuristicPolicy`** — deterministic greedy best-first: score = parent
  score × edge confidence × decay, with step/claim budgets and a score
  floor. Same inputs, same reconstruction — used by the tests, and the
  **eval baseline** every LLM policy is measured against
  (`cave eval` reconstruction cases run it when no agent is given).
- **`llmPolicy`** — the model makes the select/stop decisions
  (spec §18): each step renders the query, the claims collected so
  far (canonical CAVE text) and the strongest frontier cues, and the model
  replies with the cue to expand next or `STOP`. One completion per step —
  stop rides on select, `done` only enforces the hard budgets. Scoring
  stays the local heuristic arithmetic: models are better spent on
  select/stop than on per-edge multiplication. Replies parse leniently
  (exact cue, last line, first word-bounded mention, stop token); an
  answer naming nothing degrades to the strongest cue, so a rambling model
  behaves like the heuristic instead of ending the reconstruction. Agent
  errors propagate — a failing agent must look like a failure, not a
  decision to stop.
- **`shellComplete`** — a `Complete` from a shell-agent command template,
  the same `--agent` contract as `cave ingest` and `cave eval`: prompt on
  stdin (and `{prompt-file}`, substituted shell-quoted), reply on stdout,
  non-zero exit or timeout rejects. The model stays out-of-band (§19.5); no LLM SDK is a
  dependency of this package.

## External process boundary

The same module owns every CAVE integration that starts a local process.
`directCommand(executable, args)` plus `runProcess` passes ordinary arguments
without shell parsing. A string agent or hook template is deliberately shell
syntax: `shellCommand` selects `/bin/sh` on POSIX and PowerShell 7 (`pwsh`) on
Windows, quotes each substituted placeholder for that shell, and still starts
the shell executable with Node's `shell: false`. PowerShell scripts cross the
native Windows argv boundary through `-EncodedCommand`, so embedded quotes are
preserved before PowerShell parses them. PowerShell 7's standard native argument
passing also preserves embedded quotes when templates invoke executables.
Templates therefore use the
syntax of their target platform; placeholder values are data, not syntax.

Execution captures stdout and stderr separately (defaults: 8 MiB and 1 MiB),
returns normalized exit code/signal data, and raises a typed `ProcessFailure`
for spawn, timeout, cancellation, or output-limit failures. Those diagnostics
never include the command, arguments, input, or environment. Timeout,
cancellation, and limit failures terminate the complete process tree (a POSIX
process group or Windows `taskkill /T`), not only the immediate shell. The
`runProcessSync` bridge gives compatibility-sensitive synchronous APIs the same
behavior through a short-lived worker.

## Evaluating a policy

`cave eval` reconstruction fixtures (a `<stem>.loop.cave` sibling
declaring seeds, an optional query, and budgets) score any policy's
reconstruction against a golden by claim key — the heuristic without
`--agent`, `llmPolicy` over the agent template with it:

```sh
cave eval loop-suite/                      # the heuristic baseline
cave eval loop-suite/ --agent 'claude -p'  # the LLM policy vs that baseline
```

## Demo

```
pnpm --filter @cavelang/loop demo
```

The multi-hop recovery pattern central to the paper's thesis: starting
from the *symptom* cue `reject-valid-tokens`, the loop crosses two edges
that only exist as inverse reads (`CAUSED-BY`, then `PART-OF` — the exact
gap `REVERSE` closes) into the `topic/auth-hardening` cluster, expands it,
and surfaces the bug claim and its fix — without wandering into unrelated
knowledge. `cave reconstruct --db k.db <seed…> [--agent …]` runs the same
loop over a real store.

## Tests

```
pnpm --filter @cavelang/loop test
```
