# @cavelang/automate

Automations (spec §29): the **event-driven loop** over a CAVE store —
the last leg of sense → model → conclude → act → record. Rules fire when
invoked, actions when called, `cave connect --watch` when a *file*
changes; automations watch the *store*: in-band declarations pair a
trigger pattern with named steps, and new claims matching the trigger
fire rules, actions, out-of-band hooks, or an agent prompt.

```cave
automation/page-on-spike HAS automation: `?svc IS service, ?svc HAS error-rate: ?r, ?r > 0.05 => action/open-incident, hook/page, "investigate the spike on ?svc and record findings"` ; page and investigate error-rate spikes
```

The body is the §24.1 rule line pointed at the change feed: the left
side is the trigger — §24.1 premises verbatim (CAVE-Q patterns and
`?var op value` constraints; no bare-`?param` segments, an automation
has no caller) — and the right side is a comma-separated list of steps:

- `action/<name>` — execute the [§25 action](../act/README.md#what-executing-means-252254), its parameters bound from
  same-named trigger variables (the action's own preconditions, shape
  gate and hook all apply — an automation is just an unattended caller);
- `hook/<name>` — run the named shell template from the same §25.4
  configuration actions use, `{automation}`/`{<var>}` placeholders
  shell-quoted, the trigger claims as canonical CAVE on stdin.
  `{automation}` always names the firing automation, even when the trigger
  binds `?automation`; use another variable name to expose that value to a hook;
- a `"…"`/`` `…` `` literal — an agent prompt: bound `?var`s substitute,
  once at template occurrences only; inserted values, including other `?tokens`
  and replacement metacharacters such as `$&`, remain literal. Then
  the trigger claims ride along, and the agent's CAVE reply is appended
  stamped `@src:automation/<name>` (claims equal to current belief are
  skipped, so a restated trigger wakes nothing). Equality requires the same
  key, value and exact confidence: tiny revisions, retractions to zero and
  reactivation remain distinct. Claims participating in reply qualifier edges
  are retained even when equal, so the reply's structure survives. Claims are
  considered in reply order: a later line is compared with earlier revisions
  from that reply. A change followed by restoration keeps both revisions;
  consecutive equal unreferenced claims append only once. Vocabulary refresh,
  deduplication reads and reply insertion share one write transaction, so another
  connection cannot change the compared beliefs before insertion. Thrown errors
  roll back reply claims and vocabulary; parse diagnostics retain the lenient
  reply policy. The agent completes before this transaction begins. During
  settlement, a reply persistence error is reported as a failed prompt step;
  later steps still run. The recorded firing watermark remains durable, so
  correcting the write failure does not replay that event. A new event can
  invoke the agent again and persist a new reply.

```ts
import { declareAutomations, settle } from '@cavelang/cli/automate'

declareAutomations(store, automationFileText)
await settle(store, { hooks, complete })
// one settle cycle: rules fire (§24, incremental), triggers evaluate,
// firing solutions run their steps, and appended claims feed the next
// pass until nothing fires
```

## Operating an automation

| Situation | Guidance |
|---|---|
| Loading reports malformed stored declaration text | [Stored-body recovery](#declarations-and-stored-body-recovery) distinguishes repair from redeclaration and rearming. |
| An action step fails its preconditions or shape gate | [Action execution](../act/README.md#what-executing-means-252254) describes validation and effects. |
| A run reports `incomplete`, or a watcher retries a failed cycle | [Watch cycles and completion](#watch-cycles-and-completion) explains pass limits, diagnostics and retained watermarks. |
| A process is stopped while a step or callback is running | [Cancellation and callbacks](#cancellation-and-callbacks) explains cleanup, exit status and which work will not replay. |
| Claims are merged from another store or annotated text | [Sync identity and merge semantics](../sync/README.md#what-merging-means-281284) explains replay, conflicts and atomicity. |

## Semantics (spec §29.2–§29.4)

Topics in this section:

- [Declarations and stored-body recovery](#declarations-and-stored-body-recovery)
- [Bindings and action parameters](#bindings-and-action-parameters)
- [Step failures and batch preparation](#step-failures-and-batch-preparation)
- [Events, watermarks and hook configuration](#events-watermarks-and-hook-configuration)
- [Reply vocabulary and measurements](#reply-vocabulary-and-measurements)
- [Scaling diagnostic and measurements](#scaling-diagnostic-and-measurements)

### Declarations and stored-body recovery

Declaration calls validate the whole prelude before consulting its digest
cache, including old cached digests. Prelude diagnostics retain original file
line numbers after automation declarations, including comments and blank lines,
for LF and CRLF input. Diagnostic collection is iterative: shared regression
coverage checks all 130,000 errors and unchanged store contents for rules,
actions and automations. Input and diagnostics still reside in memory.
An invalid prelude appends nothing and
declares no automations. Corrected retries work normally, and successful
unchanged preludes append nothing. Once the prelude is valid, errors in
individual automation bodies still allow other valid declarations to proceed.

Declaration idempotence reads the newest row for the automation's subject and
attribute directly, instead of loading every current belief for each declaration.
The newest row across actor series is necessarily current in its own series;
retractions and negations participate in that lookup so an older enabled
declaration cannot make a necessary re-declaration appear unchanged. Listing and
retraction enumerate current declaration series through the attribute index,
without materializing unrelated beliefs. Discovery keeps disabled rows until
after selecting each subject's newest actor series, so an older enabled
declaration cannot revive it. Retraction selects all active declaration series
for the requested subject inside its write transaction.

Loading and listing reject an enabled declaration whose stored `value_text` is
not text with a `TypeError` identifying the field and claim ID. This distinguishes
malformed storage from an invalid automation body, which remains a reported parse
problem. Repairing the stored value permits loading and settling again; rejection
during declaration loading does not claim the pending event batch. Earlier rule
derivation in the same settle call may already have committed its own work.
`cave automate --list` and `--once` report this storage error on stderr, exit 1,
and emit no stdout even with `--json`. After repair, listing returns normally
and settlement can process the pending event.
Redeclaring a valid body is another way to restore an enabled automation, but it
appends a new declaration and arms at that newer transaction. Events before the
new declaration are not replayed. It leaves the malformed historical row intact;
it is not a repair of stored history. Retraction must decode the current claim,
so a malformed current body can prevent retraction; that failure rolls back the
retraction transaction. Once a valid declaration supersedes it, ordinary listing,
settlement and retraction work again.

### Bindings and action parameters

Trigger bindings preserve variable names such as `__proto__` and `constructor`
through joins, prompt substitution and firing-report JSON. Prompt substitution
uses only actual bound names; it does not consult inherited object properties.
Action steps preserve supported parameter names such as `constructor`,
`toString` and `hasOwnProperty` when forwarding trigger bindings. Action
parameters follow the narrower action grammar and must start with a letter;
`__proto__` is valid as a trigger variable but cannot be declared as an action
parameter. Forwarded action effects retain normal provenance and lineage, and
settling again does not replay the consumed event.
Action binding lookup uses only actual trigger variables. An unbound parameter,
including names such as `constructor` or `toString`, produces a named failed
step instead of reading an inherited JavaScript property. Later steps still
run; the claimed event is not replayed on the next settle.
`cave automate --once` reports that failed step in text or JSON and exits 1,
while successful later effects remain stored. Repeating the command with no
new event exits 0 without repeating those steps; it does not repair the earlier
missing binding or turn the failed step into a success.

### Step failures and batch preparation

Step execution also contains thrown action or prompt errors: a write failure
rolls back that step's transaction, records its diagnostic as a failed outcome,
and lets later steps run. The firing watermark stays committed, so correcting
the write failure does not replay the event; a new event can execute the steps
again. Cancellation still stops the cycle, and errors outside step execution
(such as trigger evaluation, premise serialization or watermark writes) still reject settlement.
Premise serialization completes for the entire firing batch before its watermark
is written or any step runs. A malformed stored claim therefore leaves that
batch available for retry after repair. The CLI reports preparation errors on
stderr with exit status 1 and no stdout, including in `--json` mode; repair the
stored claim and rerun settlement. Prepared claim text shares the trigger
selection transaction and cannot pick up later metadata changes while an earlier
step awaits its agent. Within a batch, each distinct premise row is projected
and serialized once, while each solution retains its own deduplicated claim
list in join order. The text cache ends with that batch: later events capture
current metadata again. This reduces repeated preparation of shared premises
without changing firing counts or skipping per-solution steps.
Cancellation is checked again after preparation and before the watermark write.
If the signal has been raised during synchronous preparation (for example by
an instrumented store projection), settlement propagates its original reason
without claiming that batch; a fresh invocation can retry. This checkpoint does
not interrupt synchronous work or cause queued signal events to run. Cancellation
after the watermark commits retains the existing claimed-batch behavior.
If premise preparation fails while cancellation is raised, an `AggregateError`
retains the cancellation reason first and the preparation failure second, with
the cancellation reason as its cause. An error already containing that reason
is preserved unchanged. Both paths leave the batch unclaimed for a fresh retry.
Earlier completed batches or derivation writes remain
committed if a later batch fails preparation.

### Events, watermarks and hook configuration

- **Events, not state.** Triggers join over current positive beliefs
  exactly like rules (§24.2), but a solution fires only when it cites a
  row *newer than the automation's watermark*. Declaring **arms** the
  automation — rows recorded before the declaration are state; a
  retraction fires nothing; an unchanged re-assertion appends no row and
  so fires nothing; a transitive (`VERB+`) premise cites its supporting
  edge rows, so a new edge fires exactly the solutions whose connection
  it backs. Arming floors the stored watermark at the current
  declaration row's tx, so a re-declared automation never fires over
  rows recorded while it was retracted. Retraction reserves its write transaction
  before reading the current declaration series, so it also retracts actor
  declarations committed before that reservation. Existing firing history stays
  in the append-only store.
- **The watermark is the firing log.** Firing appends one in-band
  `automate-watermark` claim (§24.4's convention, counts in the
  comment) *before* the steps run — a crash never replays outside-world
  steps, re-runs never re-notify, and quiescent cycles append nothing.
  Changing alias matching can recompute derived facts, but does not rewind this
  firing log. Trigger rows at or below the watermark remain old events, even
  if the new alias policy makes them match. Newly appended supporting rows
  remain eligible under the ordinary event test.
- **Batch claims are atomic.** Each automation reloads its declaration and
  vocabulary, evaluates triggers, serializes all matched premise claims, and
  advances its watermark within one write
  reservation. Concurrent settlers cannot claim the same batch. Each declaration
  is rechecked after earlier steps finish; revocation before the reservation
  prevents firing, while already-claimed steps continue. Steps run after commit,
  leaving the store writable while an agent runs. Calling `settle` inside a
  caller-owned transaction rejects before derivation or claims, because a
  savepoint cannot make the firing log durable before external execution.
- **Deaf to its own echo.** Explicit actor provenance excludes engine
  bookkeeping (`cave-automate`, `cave-derive`, `cave-act`), while lifecycle
  runs exclude the automation's own output (`automation/<name>` and its
  `action/<x>` steps). Authored sources cannot bypass either check. Another
  automation's output triggers normally —
  chains are the composition mechanism, and they converge because every
  write path is idempotent.
- **Out-of-band execution** (§19.5): the store only ever *names* hooks
  and *phrases* prompts; the hook commands (`--hooks hooks.json`,
  `$CAVE_HOOKS`) and the agent command (`--agent`, the `cave ingest` /
  `cave eval` shell contract) live in configuration. They share the bounded
  process runner: explicit `/bin/sh` or PowerShell 7 templates,
  platform-specific placeholder quoting, and whole-tree timeout cleanup.
  CLI hook files must be valid UTF-8 JSON objects with nonblank hook names and
  string commands; names and commands must contain well-formed Unicode. These
  checks match action execution and doctor diagnostics. Invalid configuration
  fails before settlement, leaving firing logs and watermarks unchanged so a
  corrected retry can consume the pending events.
  `settle()` validates configured hook budgets before any transaction,
  derivation, firing log or watermark update. Timeout seconds must resolve to
  whole milliseconds in `0..2147483647` (`0` disables the deadline), and output
  byte limits must be non-negative safe integers. Decimal values such as `1.001`
  normalize to 1001 ms. Invalid budgets reject settlement without consuming
  events; correcting configuration allows a retry. These checks cover both
  direct hooks and hooks reached through action steps. Failures during actual
  execution retain the existing recorded-firing semantics.
  Hook commands must be own entries in the configured mapping. Prototype names
  such as `constructor` and `toString` are unconfigured unless explicitly
  supplied; inherited command entries are ignored.
  Direct `settle()` calls validate the mapping before any store work, as the
  CLI does for hook files. Nulls, arrays and non-string own command data entries
  reject settlement without consuming events, including unused entries.
  Accessor-backed commands retain lazy lookup; preflight does not invoke getters
  or validate their eventual return values.
  A getter exception or non-string returned command records a failed hook step,
  with a generic diagnostic for exceptions, and later steps continue. The firing
  remains recorded, so a later settle does not automatically repeat that event.

### Reply vocabulary and measurements

Reply canonicalization calls the store's version-aware `registry()` under the
write reservation. Peer commits refresh the cached vocabulary before parsing;
an unchanged registry does not need a forced full-history rebuild for each
reply. This retains inverse and rename resolution across connections.

Run `node scripts/automation-reply-registry-bench.mjs` alone from the repository
root to measure unchanged replies with 100, 1,000 and 3,000 declared verbs.
The benchmark uses five samples per fixture, with setup and history/result
assertions outside timing. Local medians for 3,000 declarations were:

| Runtime | Forced rebuild | Version-aware registry |
|---|---:|---:|
| Node 24.16.0 | 32.13 ms | 0.028 ms |
| Node 26.5.0 | 22.46 ms | 0.028 ms |

These measurements cover unchanged local vocabulary. An external commit still
invalidates the cache and may rebuild declaration history; this is not a bound
on arbitrary reply parsing or write cost.

### Scaling diagnostic and measurements

For a repeatable scaling diagnostic, run `pnpm bench:automation` from the
repository root. Each fresh in-memory fixture derives `ready` claims from
100, 500, or 1,000 incoming events, triggers one action per event, verifies
the exact handled entity set, then checks that a second settle performs no
firings or writes. JSON lines record runtime metadata, active/quiet timings,
passes, derivation counts and stored rows. Timing excludes initial ingestion
and verification; no hardware-dependent threshold is imposed. This measures
the local rule/automation/action path, not external shell or agent throughput.
Add `--shapes` to declare `handled EXPECTS owner #cardinality:one` and have
each action append both the handled state and owner. This mode verifies every
owner binding and all final shape checks, exercising populated shape snapshots
before and after each action. The report identifies the mode and final check
count; its timings are distinct from the default no-shape fixture.
Add `--large` for 1,000, 2,000 and 4,000 events, or combine it with `--shapes`
to measure populated shape checks at those sizes. Large shape runs can take
several minutes. Run the two modes separately for comparable timing; all entity,
owner, shape and zero-write quiet-cycle assertions remain enabled.

Add `--repeat` to execute every handled action again after the quiet cycle.
The additional `repeat` records report elapsed time and verify every action
returns only unchanged effects and that no claim rows were appended. This
measures idempotent action execution separately from an idle automation loop.
An isolated shaped run after deferring action shape snapshots until the first
changed effect measured 513.1 ms for 1,000 repeated actions on Node 26.5.0 /
SQLite 3.53.3, macOS arm64. The initial settle still performed all 1,000 shape
checks and took 11.61 seconds; repeated unchanged actions took no gate snapshots.
This single observation does not remove the cost of populated gates on writes.

After adding rule vocabulary fingerprints and refreshing vocabulary on qualifier
edge appends, an isolated run on Node 26.5.0 / SQLite 3.53.3, macOS arm64,
measured the default workload sizes. The two modes ran separately with no
concurrent tests or builds:

| Events | Active, no shapes | Quiet, no shapes | Active, with shapes | Quiet, with shapes |
|---|---:|---:|---:|---:|
| 100 | 48.2 ms | 1.8 ms | 209.4 ms | 2.3 ms |
| 500 | 280.3 ms | 5.9 ms | 3281.4 ms | 6.4 ms |
| 1,000 | 787.7 ms | 11.4 ms | 12292.8 ms | 12.8 ms |

Every active run settled in two passes, derived and handled exactly the expected
entities, and checked the expected owners and shapes where enabled. Every quiet
run fired zero actions and appended zero rows. The companion fingerprint adds
one initial bookkeeping row for this one-rule fixture, with no writes on quiet
reruns. These single observations retain the earlier quiet-cycle behavior;
they do not establish a timing guarantee or remove active shape-gate scaling.

A large-workload audit before narrowing positive-fact projections, on
2026-09-07, Node 26.5.0 / SQLite 3.53.3 on
macOS arm64, produced the following observations. Each mode ran separately;
all expected entities, actions and (where enabled) owner bindings and shape
checks passed. Every quiet cycle appended zero rows.

| Events | Active, no shapes | Quiet, no shapes | Active, with shapes | Quiet, with shapes |
|---|---:|---:|---:|---:|
| 1,000 | 788.7 ms | 11.0 ms | 14448.6 ms | 14.0 ms |
| 2,000 | 2378.5 ms | 22.1 ms | 56999.1 ms | 27.7 ms |
| 4,000 | 8550.6 ms | 42.7 ms | 231311.9 ms | 49.3 ms |

These are individual observations, not performance guarantees. Both active
modes grow faster than event count in this fixture; populated shape gates
show approximately quadratic growth across these sizes. Quiet-cycle time is
much smaller and approximately proportional to event count. Indexed declaration
lookup and the no-expectations fast path avoid unrelated scans, but populated
shape gates still evaluate before and after each action. Narrowing checks to
affected constraints is a remaining optimization opportunity that must preserve
new-violation rejection and rollback. External steps and disk-backed stores
require separate measurements.
An isolated trial deferred copying/sorting observed units until a violation
was reported. The 1,000-event shaped workload measured 14.21 s before and
14.19 s after, which did not establish a material improvement. That trial was
reverted; the measurements do not justify treating unit-array allocation as
the primary scaling problem.
A subsequent CPU profile attributed about half its sampled time to reading
shape facts. The fact query already excludes negations and retractions, so it
now omits their redundant confidence/negation columns from the JavaScript
projection. The 1,000-event shaped run then measured 12.39 s versus the prior
14.21 s local baseline, with all assertions passing. This reduces transfer and
indexing work; it does not remove repeated full evaluations or establish a
different scaling order. The larger table above predates this change.
Building observed indexes only for requested attributes and relation directions
subsequently measured 11.61 s at 1,000 shaped events versus 12.39 s with the
narrower projection alone. The same benchmark assertions passed; this remains
a local observation and does not eliminate full-evaluation scaling.

A later isolated rerun of all three shaped sizes on the same Node/SQLite and
platform combination measured the projection/indexing implementation before
the rule vocabulary-fingerprint change:

| Events | Active, with shapes | Quiet, with shapes | Final shape checks | Quiet writes |
|---|---:|---:|---:|---:|
| 1,000 | 11636.1 ms | 12.6 ms | 1,000 | 0 |
| 2,000 | 45928.1 ms | 24.0 ms | 2,000 | 0 |
| 4,000 | 186204.2 ms | 53.2 ms | 4,000 | 0 |

Each active run settled in two passes, fired exactly one action per event,
and verified every expected handled entity and owner. These remain single
observations per size. They extend the earlier 1,000-event follow-up to the
larger workloads: active times are about 20% below the pre-optimization table,
while doubling events still approximately quadruples active time. The shared
shape gate still evaluates the full constraint set before and after each action.

## CLI

```sh
cave automate --db k.db --declare automations.cave
cave automate --db k.db --once                      # one settle cycle (cron mode)
cave automate --db k.db --hooks hooks.json --agent 'claude -p'   # the loop
cave automate --db k.db --list
cave automate --db k.db --retract page-on-spike
```

## Command input and cleanup

Declaration files and binary stdin must contain valid UTF-8. Streaming input
preserves characters split across buffer chunks; invalid bytes reject the whole
input before declaration or prelude claims are appended. Diagnostics identify
the file or stdin, and a corrected declaration can be retried normally.
A stream error or close before EOF also rejects the buffered declaration; an
incomplete UTF-8 sequence at EOF is an encoding error. Failure removes the
reader’s listeners and leaves existing claims unchanged.

Declaration stdin cleanup attempts pausing and every listener removal even if
one operation throws. Input or cancellation errors are retained alongside cleanup
errors; the command exits unsuccessfully and does not ingest the buffered prefix.
Cleanup failure after normal end-of-input also prevents declaration ingestion.
Listener-registration and stream-startup failures use the same cleanup path,
including when setup has attached only some of the listeners.
Correcting the stream and starting a new declaration command permits a clean retry.
Cancelling a pending declaration read discards its buffered text and detaches
its input listeners without appending claims. The reader pauses, but does not
destroy, a caller-supplied stream. Cancellation is checked again before the
completed input is declared. Cancellation with successful cleanup is quiet, like watch-mode
shutdown: the CLI exits with 130 for SIGINT or 143 for SIGTERM after cleanup.
An already-cancelled invocation returns before argument handling or database
access, including declaration, list, retract, and once modes. It cannot create
an empty database or retract an existing automation.
The programmatic command entrypoint captures `context.signal` once, so a
getter-backed context cannot lose an already-requested cancellation while the
command constructs its I/O context.

Once a command opens its store, it waits for its work to settle and attempts
store close once. Close failures are reported on stderr and return status 1 from
`runAutomate`; they are not suppressed by a cancellation request. When command
work and close both fail, the diagnostic includes both messages in that order.
Command and watch diagnostics use `[unprintable thrown value]` when converting
an exception to text would throw. Reporting failures retain both the original
operation and diagnostic-write failures in their aggregate; a persistently
failing final stderr sink still rejects after owned resources are cleaned up.
Cancellation without an independent failure remains quiet when cleanup succeeds. Completed declaration,
retraction or settling writes are not undone by a later output or close failure.
This applies to declare, list, retract, once and watch modes. A close attempt
does not guarantee release when the native close itself fails.

## Watch cycles and completion

Startup completes its cycle before the ready message and polling timer are
created. Later ticks skip an active cycle, so a slow action cannot start a
second concurrent settle through the daemon. Skipped ticks do not queue extra
cycles: the active cycle checks for writes made while it was running, and the
next idle tick checks for changes after its final boundary. Cancelling startup
returns without creating the polling timer.

The loop settles at startup, then polls `MAX(tx)` (default every 2 s)
and settles whenever it moves — one machine, one SQLite file: polling,
not a bus. A failed polling watermark read is reported as `cave automate poll`
on stderr without advancing the last processed boundary. The next poll retries
pending work; a transient read failure does not terminate the watch. Poll
callbacks return without reading once cancellation is requested, including a
retained callback invoked after store shutdown. If reporting a poll or cycle
failure itself throws, the watch stops instead of leaving an unhandled timer
exception or rejected cycle promise. It disables polling, removes its abort
listener, attempts timer cancellation and waits for the active cycle before the
command closes its store. The original failure and diagnostic-output failure
remain paired. The command can report them if stderr recovers; if the final
stderr write also throws, the programmatic call rejects after resource cleanup.
A cycle takes its boundary *before* settling and re-settles
until `MAX(tx)` holds still across one, so a write landing mid-cycle is
settled by that cycle rather than silently marked seen. `--once` exits
nonzero when settling is incomplete, a step failed, or a stored declaration
does not parse. Reports expose `complete`: a quiet final pass must confirm
completion, including enabled rule derivation. Pass exhaustion prints
`incomplete` in text output; retrying keeps committed watermarks and does not
replay steps. If derivation hits its separate limit, run `cave derive` with a
higher `--max-passes` before retrying. `settled(report)` requires completion
and no declaration or step failures. Malformed stored rules are included in
`problems` when derivation is enabled, making `--once` fail even if valid rules
and automations finish normally. `--no-derive` skips those rule checks.

Incomplete derivation does not prevent the pass from evaluating automation
triggers against the current store. A matching event can still claim its batch
and run steps, even though the cycle reports `complete: false`. The report is
therefore not an all-or-nothing transaction result. Recovery keeps those firing
watermarks and does not repeat the steps. If a workflow requires fully reconciled
rule support before any external step, finish `cave derive` successfully before
starting automation and coordinate writers so premises do not change between
those operations.

## Cancellation and callbacks

`settle` and `watchCycle` accept an `AbortSignal` through `options.signal`.
Cancellation rejects before further batch claims or steps and discards agent
replies received after cancellation. Committed watermarks remain intact, so
unfinished steps in an already-claimed batch are not replayed. Completion
callbacks must cancel their own work; the engine waits for them to return.

Cancellation alone makes `runAutomate` return 0; the CLI maps SIGINT and
SIGTERM to 130 and 143 after cleanup. An independent failure during cancellation,
such as a failed report write or watcher read, is still reported and makes
`runAutomate` return 1. The CLI process signal status takes precedence when a
SIGINT or SIGTERM was received.
The engine also retains step failures concurrent with cancellation, including
errors already wrapping the cancellation reason. Claimed batches keep their
watermarks and are not replayed after such a failure.
If the final diagnostic write itself throws, the command rejects with an
aggregate retaining the original command or cleanup errors and the output
failure, after attempting store cleanup.

Each `settle` call captures its top-level options once before starting the cycle,
including the signal, completion callback, derivation and shape settings, hook
mapping reference and limits. Replacing fields on the caller's options while a
completion is pending cannot disable cancellation or change the running cycle's
settings. Hook command getters in the captured mapping remain deferred until
their step executes. An already-aborted signal rejects before other options
are read.
`watchCycle` captures the same settings for its complete invocation, including
all repeated settle calls and report callbacks. A callback cannot replace the
running cycle's signal or disable its post-report cancellation check by mutating
the caller's options. A new invocation captures the caller's current settings.
An agent callback rejection becomes a failed prompt step, and later steps in
the firing still run. If the thrown value cannot be formatted, its detail is
`[unprintable thrown value]`; formatting does not abort the cycle. The report
remains JSON-serializable. The already-recorded event is not retried merely
because the agent failed, while new trigger events remain eligible to fire.
Cancellation retains its separate signal checks and rejection behavior.

CLI prompt-agent stdout must be valid UTF-8; malformed bytes fail the prompt
step before any reply claims are appended. The firing is already recorded, as
with other execution failures: correcting the agent and rerunning does not
replay that event. Later trigger events can fire normally.
CLI agents receive the process runner's cancellation signal, while synchronous
hooks keep their configured timeout. Busy watch cycles yield between settles
so shutdown callbacks can run; cancellation during startup exits without
starting a polling timer.
## Limits

`maxPasses` bounds each `settle` call and must be a positive safe integer
(default 20). Only omission selects defaults for pass and hook-timeout limits;
explicit null is invalid. Supplied `derive`, `check` and `aliases` must be
booleans. Omission enables derivation and shape checks and disables alias
matching. Nonnumeric hook timeouts are rejected without invoking object
conversion methods. Invalid limits reject before claims, watermarks, or completion
callbacks are processed; the CLI rejects invalid `--max-passes` before opening
the database. The daemon's `watchCycle` may repeat
those bounded calls until the database is stable; its signal is the way to
stop that work while writes continue arriving.
The daemon's `--interval` accepts whole milliseconds expressed as
0.001..2147483.647 seconds (default 2),
matching the runtime timer's range. Out-of-range values fail before opening
the database; a very large interval cannot silently become a 1 ms polling loop.
The agent's `--timeout` uses the same positive whole-millisecond range and is
also validated before opening the database.
Deliberately **not** an MCP tool (§28.5's reasoning) — the loop is a
process the operator runs; but declarations are ordinary claims, so an
agent can declare an automation through `cave_add` and a running loop
serves it from the next cycle.

Declaration entry points refresh peer vocabulary through the store's version-aware
cache inside their write reservation. They retain inverse and rename resolution
without rebuilding unchanged history on every repeated declaration. Shared
idle derivation, settling and declaration measurements are recorded in
[the architecture guide](../../ARCHITECTURE.md#write-path).

Part of the [CAVE monorepo](../..); the specification lives in the
repository's `.claude/skills/` directory (spec §29 in
`cave-storage-query`).
