# @cavelang/act

Action templates (spec §25): named, parameterized **governed writes**
over a CAVE store — the kinetic layer's entry point. Instead of freeform
appends, callers (humans at the CLI, agents over MCP) execute a declared
vocabulary: parameters are validated, CAVE-Q preconditions are checked
against current belief, effects append atomically with provenance and
lineage, and a config-declared hook can carry the decision to the
outside world.

```cave
action/mark-deployed HAS action: `?service, ?version, ?service IS service => ?service HAS deployed-version: ?version` ; record that a service version reached production
action/mark-deployed/service IS param ; the service that was deployed
action/mark-deployed/version IS param ; the version now running
action/mark-deployed HAS hook: deploy-notify
```

The body is the §24.1 rule line put in the caller's hands: bare `?name`
segments on the left declare **parameters**, everything else on the left
is a §24.1 premise verbatim (CAVE-Q patterns and `?var op value`
constraints), and the right side is a comma-separated list of **effect
templates** — ordinary claim lines whose variable slots are filled from
parameters and premise bindings.

```ts
import { act, declareActions } from '@cavelang/cli/act'

declareActions(store, actionFileText)
act(store, 'mark-deployed', { service: 'api-gateway', version: '1.2.3' })
// → appends `api-gateway HAS deployed-version: 1.2.3 @src:action/mark-deployed`,
//   linked BECAUSE to the matched precondition row and VIA to the declaration
```

A solver recommendation is only an untrusted proposal. Route it through the
same boundary; the action engine resolves the current declaration and repeats
parameter, premise, shape, transaction, and hook checks at execution time:

```ts
import { actProposal } from '@cavelang/cli/act'

actProposal(store, {
  action: 'mark-deployed',
  parameters: { service: 'api-gateway', version: '1.2.3' }
})
```

No solver result can append effects directly or preserve authority from an
earlier snapshot whose preconditions have since changed.

Declaration calls validate the whole prelude before using its digest cache,
including old cached digests. Prelude diagnostics retain original file line
numbers after action declarations, comments and blank lines, for LF and CRLF
input. Diagnostic collection also handles large invalid preludes without
JavaScript's function-argument limit; input and problems still reside in memory.
The same iterative collection covers effect-body diagnostics, including large
sets of forbidden variable-bearing contexts. Rejected metadata is reported
without accepting an action; corrected input can be parsed normally.
Invalid preludes append nothing and declare no
actions; corrected retries work normally, and successful unchanged preludes
append nothing. With a valid prelude, errors in individual action bodies still
allow other valid declarations to be processed.
An invalid replacement body leaves its previous definition active. Valid
prelude entries, including hook references and parameter documentation, can
still change in that same import. Inspect declaration problems before executing
an imported action: it may retain its old body with newly imported metadata.
Correct the reported body and repeat the import; unchanged valid declarations
and prelude entries are skipped, while the corrected definition is installed.
The CLI exits with status 1 when any declaration problems remain, prints their
source lines on stderr, and reports accepted and unchanged counts on stdout.
That failure status does not mean the entire import was rolled back. Use
`cave act --list --json` to inspect the current bodies and hook references after
a partial import.

`listActions` derives action bodies, parameter descriptions and hook references
from one current-belief read, including on read-only connections. A concurrent
commit cannot mix older bodies with newer metadata in one listing; the next
call sees the update. Parameter descriptions and hooks are indexed once per
listing instead of rescanning current beliefs for each parameter.
Hook references use the newest declaration across actor series, including a
retraction that disables older hooks. Parameter descriptions use the newest
current positive `IS param` declaration; a newer positive declaration without
a comment clears the displayed description. Retracted actions are omitted.

Or from the CLI:

```sh
cave act --db k.db --declare actions.cave
cave act --db k.db mark-deployed service=api-gateway version=1.2.3
cave act --db k.db --list
cave act --db k.db --retract mark-deployed
```

## What executing means (§25.2–§25.4)

- **Actions are in-band claims** — `action/<name> HAS action: `…`` —
  identified by *name*, not digest: one current definition per name, its
  evolution an ordinary belief series. Retraction disables the action;
  effects of past executions stay — they were true when executed.
  Retraction selects all current positive declaration series inside its write
  transaction, including series committed by another writer before that
  transaction begins. If another writer has already retracted them all, the
  call reports no current action and appends nothing. Redeclaration can enable
  the action again.
  If a declaration write throws during retraction, the transaction rolls back
  every retraction in that call. Retrying after correcting the write failure
  disables the current declaration series together; past effects and their
  lineage remain recorded after both failed and successful retractions.
- **Preconditions gate, they are not evidence**: premises evaluate left
  to right over current beliefs with parameters pre-bound; a premise
  with no solution fails the action and nothing is appended. Effect
  confidence is the template's own — no noisy-AND (contrast §24.2).
- **One deterministic execution**: a premise-bound variable used in an
  effect must bind uniquely across solutions; ambiguity fails the action
  (a rule fires per solution — an action executes once, or not at all).
  Premise-bound names such as `constructor`, `toString` and `__proto__` resolve
  from actual query bindings and undergo the same uniqueness check.
  Supplied arguments must be own properties of the argument object. Inherited
  values do not satisfy required parameters, including `constructor` and
  `toString`; parameter names still must start with a letter.
  CLI `param=value` arguments may name each parameter only once. Repeated
  parameters and unknown names are errors before action effects execute.
  Parameter formatting follows its position: an argument of `20 kg` matches
  a quoted `"20 kg"` entity in a subject premise and a numeric `20 kg` in an
  attribute-value premise. Both uses retain the same captured caller argument;
  subject formatting does not rewrite the shared numeric binding.
- **Atomic, idempotent, gated**: the write reservation is acquired before
  reading the action declaration, premises, and baseline shape violations.
  The vocabulary is refreshed from stored declarations under that same lock,
  so an already-open connection sees another writer's inverse declarations.
  These checks and the effects share one transaction; a competing revocation
  committed before the lock is acquired therefore prevents execution.
  An effect equal to current belief appends nothing; the §20.3 shape
  gate runs by default and rolls back executions that introduce new
  `EXPECTS` violations (`check: false` / `--no-check` opts out).
  Programmatic `dryRun`, `check` and `aliases` settings must be booleans when
  supplied. Strings, null and other values return a failed report before
  execution, with nothing appended. Omission preserves defaults: writes are
  enabled, shape checks run and alias matching is off. Use `dryRun: true` for
  a preview; a string such as `"true"` is not a preview request.
  The baseline snapshot is deferred until immediately before the first changed
  effect. An entirely unchanged action takes no shape snapshots; parameters,
  declarations and premises are still checked. If any effect changes, the full
  before/after comparison runs even when earlier effects were unchanged.
  Expected execution refusals, such as missing premises or new shape violations,
  return `ok: false`. Storage errors and malformed active shape declarations
  encountered by the gate throw; callers must handle exceptions as well as
  inspect the returned report.
  A failure while writing effects or their provenance edges rolls back the whole
  action and never reaches hook lookup. After correcting the failure, retrying
  can append the complete effect batch with its lineage and run the hook once.
  Existing effects do not bypass premise checks: if a qualifier edge removes
  an inverse mapping, a repeat execution fails its now-unsatisfied premise,
  including when another connection committed the edge. The previously executed
  action's effect and lineage remain intact; refusing a new execution does not
  retract past assertions. Normal and dry-run executions share this behavior.

- **Provenance and lineage**: effect rows are stamped
  `@src:action/<name>` (§9.5) and point `BECAUSE` at the premise rows of
  the justifying solution and `VIA` at the declaration row (§24.3's
  obligations) — `cave export` renders the execution tree.
  Each updated effect version retains its own premise and declaration row
  references, including after reopening the store. An unchanged effect keeps
  its existing row and lineage even if its premise has a newer version; it does
  not record another execution. Idempotence compares key, value and exact
  confidence equality. Small positive revisions, transitions to zero (retraction),
  and reactivation are not discarded by an absolute tolerance;
  editing only a template's tags, importance or comment does not rewrite an
  existing effect. For example, changing `#status:old` to `#status:new` while
  keeping its value reports unchanged and retains the old tag. A later value
  change appends a new version carrying the new template metadata. Each report's
  effect `line` is the instantiated template, including for unchanged outcomes;
  query the store for the retained row and its metadata. Dry runs roll back both
  effect rows and their lineage edges.
- **Hooks are out-of-band** (§19.5): the claim *names* a hook
  (`HAS hook: deploy-notify`); the shell command template lives in
  configuration (`--hooks hooks.json`, `{"deploy-notify": "curl …"}`)
  and runs strictly after commit, with `{action}`/`{param}` placeholders
  shell-quoted and the appended claims as canonical CAVE text on stdin. Hook
  parameter values are captured once during argument validation and reused after
  commit. Accessor-backed arguments cannot supply one value to the effects and
  another to the hook; non-enumerable own parameters are included too. Hook
  templates use `/bin/sh` syntax on POSIX and PowerShell 7 syntax on
  Windows; output is bounded, and timeout or limit failure kills the complete
  process tree without putting command text into diagnostics.
  The CLI validates the configuration file before executing action effects:
  UTF-8 JSON, nonblank hook names, string commands, and no unpaired Unicode
  surrogates in names or commands. Doctor uses the same validator and reports
  malformed configuration with a redacted correction hint. This validation
  precedes commit; failures from a hook that actually runs remain post-commit.
  The hook report retains the captured prefix of stdout followed by the captured
  prefix of stderr, with outer whitespace trimmed. This is not an interleaved
  event log or the tail of a failed command; output beyond a stream's byte limit
  is discarded.
  Library hook budgets are validated before action reads or writes: timeout
  seconds must be numbers resolving to whole milliseconds in `0..2147483647`, with `0`
  retaining the explicit no-timeout behavior, and stdout/stderr byte limits must
  be non-negative safe integers. Decimal seconds such as `1.001` are normalized
  to 1001 ms. Invalid budgets return a failed action report without appending
  claims; they are configuration errors, not failures of an executed hook.
  Omission selects the default timeout; explicit null is invalid.
  Nonnumeric timeout values are rejected without invoking coercion methods or
  looking up a lazy hook template. Correcting the timeout permits normal execution.
  A failing hook is reported, never rolled back into the store; no-op
  executions and dry runs never fire hooks.
  After a timeout or other hook failure, repeating the same action does not
  retry the side effect when its effects are already current. Inspect the hook
  report and reconcile the external operation separately; a timeout does not
  establish whether that operation partially completed. The committed claims
  and their lineage remain available for that review.
  At the CLI, the failed hook produces exit status 1, but a subsequent no-op
  returns 0 with `not fired (nothing changed)`. That successful retry status
  does not establish that the earlier external operation succeeded, even after
  correcting its hook configuration. A later action that changes effects can
  run the corrected hook normally.
  Hook lookup uses only own entries in the configured mapping. Inherited
  properties are unconfigured, while explicitly supplied names such as
  `constructor` and `toString` work normally. The same lookup determines whether
  a hook would fire inside a caller-owned transaction.
  Library calls validate the mapping before action writes, just as the CLI
  validates hook files: it must be an object whose own data entries are string
  command templates. Nulls, arrays and non-string data entries return a failed
  action report without appending effects, including invalid unused entries.
  Each execution captures its top-level options once before validation, including
  dry-run mode, the shape gate, alias matching, the hook mapping reference and
  process limits. Changing option getters cannot alter rollback, the reported
  execution mode or hook eligibility midway through an action. Individual
  commands in the captured mapping retain their deferred lookup after the action
  transaction; preflight does not invoke their getters or validate the eventual
  return value.
  Dry runs, no-op actions and nested-hook rejection do not evaluate getters.
  A lookup exception or non-string returned command becomes a hook error with
  `fired: false`; the action report still describes committed effects. Getter
  exception text is not included in that diagnostic.
  Stored hook references are read inside the action transaction. A binary
  value in that stored field throws before external configuration lookup and
  rolls back effects and their lineage. Binary action bodies and hook
  references report the field name and claim ID when loaded, listed or executed,
  instead of an internal string-method failure. Repairing the stored value permits a
  fresh execution; repeating its now-current effects remains a no-op. This
  differs from a configured command getter failing after commit, which retains
  the effects as described above.
  A configured hook that would fire inside a caller-owned store transaction
  rejects the action and rolls back its savepoint, preserving the caller's
  earlier writes. Execute that action outside the enclosing transaction or
  omit hook configuration. Unconfigured hooks, no-op actions, and dry runs
  remain nestable. The synchronous result reports a completed hook outcome;
  hooks are not silently queued for a future outer commit.

Action execution refreshes the store's version-aware vocabulary cache under its
write reservation. A peer commit invalidates that cache before the action uses
its premises or effects; unchanged vocabulary does not require a full registry
rebuild on every invocation.

Run `node scripts/action-registry-bench.mjs` alone from the repository root to
measure repeated unchanged actions with 100, 1,000 and 3,000 verb declarations.
Setup and result/history assertions are outside the five timed samples. Local
medians with 3,000 declarations were:

| Runtime | Forced rebuild | Version-aware registry |
|---|---:|---:|
| Node 24.16.0 | 30.63 ms | 0.097 ms |
| Node 26.5.0 | 23.18 ms | 0.090 ms |

The fixture exercises an unchanged unconditional action. Changed effects,
precondition queries, shape evaluation and hooks have separate costs. External
commits can still require a registry rebuild; these figures do not bound general
action execution time.

## Resolution note

A declaration appended by different surfaces carries different §9.5
stamps and therefore forks into per-actor belief series; `loadAction`,
`listActions` and `cave act` resolve the **newest current row across
every series** of the subject — latest belief wins, whoever appended it.
Named action and hook attributes use a parameterized latest-row query instead
of materializing all current beliefs. The latest row across all series is
necessarily current within its own series; retracted and negated rows remain
eligible so an older enabled declaration cannot reappear. Each lookup reads
fresh storage and does not cache a declaration across action executions.

Declaration entry points refresh peer vocabulary through the store's version-aware
cache inside their write reservation. They retain inverse and rename resolution
without rebuilding unchanged history on every repeated declaration. Shared
idle derivation, settling and declaration measurements are recorded in
[the architecture guide](../../ARCHITECTURE.md#write-path).

See the spec's §25 (`.claude/skills/cave-storage-query`) for the
normative semantics, and `test/` for executable examples.
