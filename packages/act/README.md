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
import { act, declareActions } from '@cavelang/act'

declareActions(store, actionFileText)
act(store, 'mark-deployed', { service: 'api-gateway', version: '1.2.3' })
// → appends `api-gateway HAS deployed-version: 1.2.3 @src:action/mark-deployed`,
//   linked BECAUSE to the matched precondition row and VIA to the declaration
```

A solver recommendation is only an untrusted proposal. Route it through the
same boundary; the action engine resolves the current declaration and repeats
parameter, premise, shape, transaction, and hook checks at execution time:

```ts
import { actProposal } from '@cavelang/act'

actProposal(store, {
  action: 'mark-deployed',
  parameters: { service: 'api-gateway', version: '1.2.3' }
})
```

No solver result can append effects directly or preserve authority from an
earlier snapshot whose preconditions have since changed.

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
- **Preconditions gate, they are not evidence**: premises evaluate left
  to right over current beliefs with parameters pre-bound; a premise
  with no solution fails the action and nothing is appended. Effect
  confidence is the template's own — no noisy-AND (contrast §24.2).
- **One deterministic execution**: a premise-bound variable used in an
  effect must bind uniquely across solutions; ambiguity fails the action
  (a rule fires per solution — an action executes once, or not at all).
- **Atomic, idempotent, gated**: effects append in one transaction;
  an effect equal to current belief appends nothing; the §20.3 shape
  gate runs by default and rolls back executions that introduce new
  `EXPECTS` violations (`check: false` / `--no-check` opts out).
- **Provenance and lineage**: effect rows are stamped
  `@src:action/<name>` (§9.5) and point `BECAUSE` at the premise rows of
  the justifying solution and `VIA` at the declaration row (§24.3's
  obligations) — `cave export` renders the execution tree.
- **Hooks are out-of-band** (§19.5): the claim *names* a hook
  (`HAS hook: deploy-notify`); the shell command template lives in
  configuration (`--hooks hooks.json`, `{"deploy-notify": "curl …"}`)
  and runs strictly after commit, with `{action}`/`{param}` placeholders
  shell-quoted and the appended claims as canonical CAVE text on stdin. Hook
  templates use `/bin/sh` syntax on POSIX and Windows PowerShell syntax on
  Windows; output is bounded, and timeout or limit failure kills the complete
  process tree without putting command text into diagnostics.
  A failing hook is reported, never rolled back into the store; no-op
  executions and dry runs never fire hooks.

## Resolution note

A declaration appended by different surfaces carries different §9.5
stamps and therefore forks into per-actor belief series; `loadAction`,
`listActions` and `cave act` resolve the **newest current row across
every series** of the subject — latest belief wins, whoever appended it.

See the spec's §25 (`.claude/skills/cave-storage-query`) for the
normative semantics, and `test/` for executable examples.
