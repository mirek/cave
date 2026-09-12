# @cavelang/loop

`cave-loop` — the active-reconstruction agent layer over the CAVE graph
(spec §18, **non-normative**). Implements Ji et al.'s Algorithm 1
(*Memory is Reconstructed, Not Retrieved*, 2026) as a functional loop, per
the spec's Cue–Tag–Content mapping (§11.3).

The agent layer is deliberately outside the language specification:
reconstruction is a *policy* over the graph, so the policy can evolve or
be swapped without spec churn. Everything here is injectable.

```ts
import { memoryStoreOfText, reconstruct, heuristicPolicy } from '@cavelang/cli/loop'

const store = memoryStoreOfText(knowledge)
const { claims, trace } = reconstruct(store, heuristicPolicy(), ['reject-valid-tokens'])
```

The LLM-driven policy (spec §18) runs the same loop asynchronously,
with any shell-agent command deciding select/stop:

```ts
import { llmPolicy, reconstructAsync, shellComplete } from '@cavelang/cli/loop'

const policy = llmPolicy(shellComplete(`claude -p`), { query: 'why are valid tokens rejected?' })
const { claims } = await reconstructAsync(store, policy, ['reject-valid-tokens'])
```

The shared `jsonValueEnds(text)` helper, exported from `@cavelang/cli/loop`,
indexes valid JSON value prefixes without recursion or decoding. At each input
offset its `Int32Array` contains the exclusive end of a valid value, or zero.
Evaluation and alias judges use it to reject malformed candidate spans before
native decoding. It preserves their separate answer-selection rules. Work and
memory are linear in input length; indexing allocates six integer arrays, so
callers should retain the existing reply-size limits.

`lastJsonArray(text, property?)`, also exported from `@cavelang/cli/loop`,
selects the last eligible array amid prose using that index. Complete JSON
strings and objects exclude their nested arrays from answer extraction. An
optional own property names a supported object wrapper: the evaluation judge
uses `pairs`, while the alias judge accepts array answers only. The helper
returns `undefined` when there is no eligible answer; callers validate entries
for their own protocol. Unfinished prose retains balanced-candidate recovery.

Each `llmPolicy.select` call captures frontier names, scores and depths before
calling the completion function. Prompt rendering and reply interpretation use
that same captured frontier, including heuristic fallback for an unparseable
reply. Caller changes while completion is pending cannot retarget the current
selection; a later call captures the updated state.

## Pieces

- **`CaveStore`** — the store contract the language guarantees the agent
  (§18): forward reads via the subject index, *named* inverse reads via
  the object index plus `inverse_of()`, current-belief resolution via
  claim keys, topic expansion via `CONTAINS` in both directions.
  `memoryStore` implements it dependency-free (and mirrors `@cavelang/store`'s
  traversal defaults: negated and `@ 0%` facts are not edges);
  revised claim keys take their latest position in input transaction order,
  matching SQLite's edge order and equal-score traversal choices.
  An additional entity index interleaves incoming and outgoing evidence in
  that same order, with self-relations once. It stores one extra reference per
  current claim and a second for relations with distinct endpoints, avoiding
  sorting each lookup; returned arrays are independent of the index.
  `sqliteStore` adapts an open `@cavelang/store` database to the same
  shape — the adapter behind the MCP `cave_reconstruct` tool and the CLI
  `cave reconstruct` command.
  Claim collection scopes indexed history to the requested entity and selects
  the latest row per claim key in SQLite, oldest current row first. It includes current
  retractions as evidence and emits self-relations once. Each call observes
  fresh history unless the caller supplies an enclosing database snapshot.
  Forward/reverse edges and entity claim collection each hold a short read
  snapshot through metadata projection, so a peer update cannot attach newer
  tags or contexts to rows selected earlier in that read. Projection failures
  propagate without publishing partial results. If releasing that snapshot also
  fails, an `AggregateError` retains the projection error first, the release
  error second, and the original projection error as its cause. An unprintable
  thrown value cannot hide either failure. If the underlying release completed
  before reporting its error, the adapter can retry inside the caller's still-open
  transaction; the caller retains commit/rollback ownership. The
  loop itself opens no transaction across asynchronous policy decisions; peer
  commits between awaited expansions can change later branches and evidence.
  Earlier collected claims remain in the result, so a live reconstruction is
  not a single historical snapshot. Use a stable in-memory store for a fixed
  input graph. The synchronous MCP tool separately provides one read snapshot
  for its complete call. SQLite examines that entity's history rather than all current
  beliefs; only current rows cross into JavaScript. A heavily revised entity
  can still require substantial database-side grouping work.
- **`Policy`** — select / score / stop, injected into `reconstruct`. The
  loop routes by expanding a cue's claims (content) and offering scored
  neighbors from forward, inverse and topic edges. `AsyncPolicy` is its
  awaited twin, run by `reconstructAsync` — same algorithm, same trace.
  Both entrypoints deduplicate seed entities in first-seen order before the
  policy sees the frontier, leaving the caller's seed list unchanged. Repeated
  seeds therefore cannot consume extra slots in a model's offered-cue limit.
  States retained by a policy keep the claim list collected at that step;
  later expansions do not append to earlier states. Adding claims copies the
  accumulated array once per expansion, while expansions with no new claims
  reuse it. Claim objects retain the store's readonly contract.
- **`heuristicPolicy`** — deterministic greedy best-first: score = parent
  score × edge confidence × decay, with step/claim budgets and a score
  floor. Same inputs, same reconstruction — used by the tests, and the
  **eval baseline** every LLM policy is measured against
  (`cave eval` reconstruction cases run it when no agent is given).
- **`llmPolicy`** — the model makes the select/stop decisions
  (spec §18): each step renders the query, the claims collected so
  far (canonical CAVE text) and the strongest frontier cues, and the model
  replies with the cue to expand next or `STOP`. Prompt scores retain two
  decimal places when that text represents the exact score; otherwise they
  use round-trippable numeric text, including scientific notation for very
  small values. Positive scores cannot appear as zero solely from display
  rounding, and distinct scores retain their distinction. One completion per step —
  stop rides on select, `done` only checks the stopping budgets. Scoring
  stays the local heuristic arithmetic: models are better spent on
  select/stop than on per-edge multiplication. Replies parse leniently
  (exact cue, last line, first word-bounded mention, stop token). Leading
  list cleanup removes a bullet or numbered marker only when followed by
  whitespace, preserving numeric, hyphen and dot prefixes in cue names.
  Trailing punctuation prefers the longest complete frontier name before
  treating a suffix as sentence punctuation, so `api:` is not shortened to
  `api` when both are available. An
  answer naming nothing degrades to the strongest cue, so a rambling model
  behaves like the heuristic instead of ending the reconstruction. Agent
  errors propagate — a failing agent must look like a failure, not a
  decision to stop.
  Empty cue names are eligible for exact replies and strongest-cue fallback,
  but are never treated as mentions inside prose. This keeps reply scanning
  finite even when a caller supplies an empty seed.
  Mention boundaries treat Unicode letters, marks and numbers, plus `_`, `/`
  and `-`, as word continuations. Neither a cue inside a larger Unicode word
  nor `STOP` inside a word or entity path counts as a standalone instruction.
  Dots and colons also continue a name when they connect it to another word
  character: `api.example` cannot select `api`, and `stop:child` cannot stop
  reconstruction. Sentence punctuation such as `api. ` or `STOP: ` still
  separates words.
  Exact frontier-name replies still take precedence over stop detection.
  Each policy captures its query, instructions and cue limit when created,
  alongside its scoring and budget settings. Mutating the caller's options
  during a completion cannot change later prompts; create a new policy to
  use new settings.
- **`shellComplete`** — a `Complete` from a shell-agent command template,
  the same `--agent` contract as `cave ingest` and `cave eval`: prompt on
  stdin (and `{prompt-file}`, substituted shell-quoted), reply on stdout,
  non-zero exit or timeout rejects. The model stays out-of-band (§19.5); no LLM SDK is a
  dependency of this package.
  The adapter captures its timeout, working directory, cancellation signal and
  output limits once when created. Later changes to the caller's options do
  not change subsequent calls; create another adapter for different settings.
  The captured signal remains live and can cancel later calls before prompt
  files or child processes are created.
  Timeout seconds must resolve to whole milliseconds within Node's timer range
  (0..2147483647 ms); `1.001` seconds is accepted as 1001 ms. Invalid settings
  throw when the adapter is created. Programmatic timeout values must be numbers;
  strings, booleans and objects are rejected without numeric coercion. Zero
  retains its meaning of no deadline.

Built-in policies validate their budgets when created, before traversal or
model completions. `maxSteps` must be a nonnegative safe integer (default 16).
`maxClaims` accepts a nonnegative safe integer or `Infinity` (the default).
Zero stops before the first expansion. Claim budgets are checked between
expansions: collecting all claims for one cue can exceed the threshold. For
example, `maxClaims: 1` still collects all three claims from a cue with three
claims, then stops before selecting another cue or requesting another model
completion. The returned frontier can therefore contain unexpanded neighbors.
Frontier merging appends new neighbors iteratively, so one broad expansion
does not exceed JavaScript's function-argument limit. A 130,000-neighbor
regression checks both synchronous and asynchronous reconstruction, including
frontier order, scores and stopping after one step. Claims, edges and frontier
still reside in memory; a step budget does not bound the size of one expansion.
The LLM policy's `maxCues` must be a positive safe integer (default 16), so a
nonempty frontier offers at least one choice. Both policy creation and direct
`selectPrompt` calls reject invalid cue limits, including on an empty frontier.
Direct prompt calls capture the query and instructions once before rendering,
so getter-backed options cannot change between presence checks and output.
A later call captures the then-current values.
Use a zero step budget to prevent model work altogether.
Both built-in policies reject a computed nonfinite neighbor score with a
`RangeError` before it can enter the frontier. A finite decay setting can still
overflow after repeated amplification; use a smaller factor or a shorter
traversal budget for such graphs. A later reconstruction can use new settings.
Both built-in policies require finite nonnegative `decay`; the heuristic also
requires finite nonnegative `minScore`. Values above one remain supported:
`decay: 2` amplifies each hop's score, while `minScore: 2` excludes initial cues
(which start at one). Zero decay suppresses neighbors under the default score
floor. Invalid scoring settings fail at policy creation.

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
The wrapper returns the last command's exact native exit code, matching the
POSIX shell contract. Templates therefore use the
syntax of their target platform; placeholder values are data, not syntax.

`runProcess` returns normalized exit code, signal, stdout and stderr data.
`runProcessSync` provides the same process behavior through a short-lived Node
worker for callers that require a synchronous API. Their options are:

| Option | Default | Behavior |
|---|---|---|
| `input` | No input | A string written to stdin; stdin is then closed. |
| `cwd` | Current working directory | Working directory for the child. |
| `env` | Parent environment | Supplied environment entries replace the ordinary inherited environment, following Node's spawn rules. |
| `timeoutMs` | `0` | Integer milliseconds in 0..2147483647; zero disables the deadline. |
| `signal` | None | Cancellation signal for `runProcess` only. |
| `maxStdoutBytes` | 8 MiB | Non-negative safe-integer stdout byte limit. |
| `maxStderrBytes` | 1 MiB | Non-negative safe-integer stderr byte limit. |
| `strictStdoutUtf8` | `false` | Reject malformed captured stdout before structured interpretation. |

Both runners capture declared options before launch, preserving inherited,
non-enumerable and getter-backed fields. The asynchronous runner retains its
original abort signal for checks, subscription and cleanup even if the caller
changes the options while the child runs. Invalid stdin types or deadlines
throw `TypeError` before a child or bridge worker starts, without echoing input.
Numeric budgets use defaults only when omitted or undefined. Explicit null is
invalid for timeout and stdout/stderr limits; it cannot silently disable a
deadline or restore a default capture limit. Correcting the budget permits a
new invocation. The deadline bound prevents Node from clamping an overflowing
timer to 1 ms.

`strictStdoutUtf8` must be a boolean when supplied. Strings, null, numbers and
objects throw `TypeError` before command access or launch, without coercion.
Omission or false permits replacement decoding; true rejects malformed stdout
with a `stdout-encoding` process failure. Both runners capture this option once.

The synchronous bridge explicitly copies the executable, argument list and
declared options. Custom `toJSON` methods on commands, argument arrays or options
cannot replace them. It also captures a flat environment: enumerable entries,
including inherited entries, with undefined values omitted and other values
converted to strings as Node does. Non-enumerable environment entries are
ignored and environment `toJSON` methods are not invoked. On Windows,
case-insensitive duplicate keys use the first key in sorted order, selected
before reading values. This is not a deep snapshot of arbitrary objects.

Output limits count raw bytes. Chunks are joined before UTF-8 decoding, so
multibyte characters split across pipe reads survive, including output exactly
at its limit. Ordinary capture uses replacement decoding. With
`strictStdoutUtf8: true`, malformed stdout raises a `stdout-encoding` failure;
valid Unicode, including an explicit replacement character, remains unchanged.
Timeout, cancellation and output-limit failures take precedence, including
when a byte limit cuts a UTF-8 character. Failure results retain decoded stdout
and stderr for diagnostics.

Spawn, timeout, cancellation, output-limit and opted-in encoding failures raise
`ProcessFailure`. Its generated messages do not echo the command, arguments,
input or environment; retained child output can still contain those values if
the child prints them. Command, working-directory and environment read failures
(including environment-entry getters) use redacted spawn failures. The bridge
also redacts request-serialization exceptions before starting its worker.
Caught launch exceptions are not inspected and omit `errorCode`; Node's
asynchronous spawn-error events retain their code, such as `ENOENT` for a missing
executable. Timeout, cancellation and limit failures terminate the complete
process tree using a POSIX process group or Windows `taskkill /T`.

After a child has been spawned, exceptions during listener registration or stdin
setup trigger process-tree termination and reject with a `ProcessFailure` of kind
`spawn`. Startup messages omit raw exception details, matching other spawn
failures. Partially registered cancellation listeners and streams receive the
same cleanup attempts as other process outcomes.

`runProcess` completion attempts timer cleanup, cancellation-listener removal and
all three stream destructions independently. Cleanup failures after an otherwise
successful process reject with a command-redacted `AggregateError`. When a
process already failed, its `ProcessFailure` kind and captured result remain
available; cleanup errors are attached as an `AggregateError` cause and its
message notes the additional failure without copying raw cleanup details.
Raw causes are retained for programmatic inspection and may contain application
error text. The synchronous bridge retains the serialized failure kind, message
and result, but does not transport JavaScript cause objects.

`shellComplete` adds the agent-specific text boundary: it rejects unpaired
Unicode surrogates in prompts before writing stdin or a prompt file, sends
valid Unicode unchanged, and enables strict stdout decoding before returning a
reply to reconstruction or automation. An already-aborted signal rejects with
its cancellation reason before creating temporary files or starting the agent.
Temporary `{prompt-file}` directories are removed after completion or failure,
including failures while writing the prompt itself. If completion and prompt
cleanup both fail, the rejection is an `AggregateError` containing the original
completion failure followed by the cleanup failure, with the completion failure
as its cause. Diagnostics tolerate unprintable thrown values. A cleanup failure
after successful completion rejects with that cleanup error; no reply is
returned. Failed cleanup is an attempted removal, not a guarantee that the
directory was removed.

## Adapter consistency audit

Run `node scripts/reconstruction-adapter-audit.mjs` from the repository root
under either supported Node major. The fixed-seed audit generates 100 histories
with revisions, repeated claims, source contexts, confidence changes, retractions,
negation, declared inverses, topics, attributes, Unicode names and literal
endpoints. It compares all five store operations, then synchronous and awaited
reconstruction across the in-memory and SQLite adapters: ordered canonical
claims, trace edges and scores, final frontier, visited entities and step counts.
It prints the failing fixture on disagreement and a JSON summary on success.

These 6,400 comparisons detect adapter and sync/async drift for the generated
cases. Agreement is not an independent oracle for language semantics, and the
audit does not cover concurrent database writes or policy mutation of readonly
claims. The adapters retain their existing contracts: SQLite reads fresh history
on each call, and claim objects are readonly rather than deeply copied.

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
