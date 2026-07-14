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

- `action/<name>` — execute the §25 action, its parameters bound from
  same-named trigger variables (the action's own preconditions, shape
  gate and hook all apply — an automation is just an unattended caller);
- `hook/<name>` — run the named shell template from the same §25.4
  configuration actions use, `{automation}`/`{<var>}` placeholders
  shell-quoted, the trigger claims as canonical CAVE on stdin;
- a `"…"`/`` `…` `` literal — an agent prompt: bound `?var`s substitute,
  the trigger claims ride along, and the agent's CAVE reply is appended
  stamped `@src:automation/<name>` (claims equal to current belief are
  skipped, so a restated trigger wakes nothing).

```ts
import { declareAutomations, settle } from '@cavelang/automate'

declareAutomations(store, automationFileText)
await settle(store, { hooks, complete })
// one settle cycle: rules fire (§24, incremental), triggers evaluate,
// firing solutions run their steps, and appended claims feed the next
// pass until nothing fires
```

## Semantics (spec §29.2–§29.4)

- **Events, not state.** Triggers join over current positive beliefs
  exactly like rules (§24.2), but a solution fires only when it cites a
  row *newer than the automation's watermark*. Declaring **arms** the
  automation — rows recorded before the declaration are state; a
  retraction fires nothing; an unchanged re-assertion appends no row and
  so fires nothing; a transitive (`VERB+`) premise cites its supporting
  edge rows, so a new edge fires exactly the solutions whose connection
  it backs. Arming floors the stored watermark at the current
  declaration row's tx, so a re-declared automation never fires over
  rows recorded while it was retracted.
- **The watermark is the firing log.** Firing appends one in-band
  `automate-watermark` claim (§24.4's convention, counts in the
  comment) *before* the steps run — a crash never replays outside-world
  steps, re-runs never re-notify, and quiescent cycles append nothing.
- **Deaf to its own echo.** Engine bookkeeping (`src:cave-automate`,
  `src:cave-derive`, `src:cave-act`) and the automation's own output
  (`src:automation/<name>`, its action steps' `src:action/<x>`) are
  never events for it. Another automation's output triggers normally —
  chains are the composition mechanism, and they converge because every
  write path is idempotent.
- **Out-of-band execution** (§19.5): the store only ever *names* hooks
  and *phrases* prompts; the hook commands (`--hooks hooks.json`,
  `$CAVE_HOOKS`) and the agent command (`--agent`, the `cave ingest` /
  `cave eval` shell contract) live in configuration.

## CLI

```sh
cave automate --db k.db --declare automations.cave
cave automate --db k.db --once                      # one settle cycle (cron mode)
cave automate --db k.db --hooks hooks.json --agent 'claude -p'   # the loop
cave automate --db k.db --list
cave automate --db k.db --retract page-on-spike
```

The loop settles at startup, then polls `MAX(tx)` (default every 2 s)
and settles whenever it moves — one machine, one SQLite file: polling,
not a bus. A cycle takes its boundary *before* settling and re-settles
until `MAX(tx)` holds still across one, so a write landing mid-cycle is
settled by that cycle rather than silently marked seen. `--once` exits
nonzero when a step failed or a stored declaration does not parse.
Deliberately **not** an MCP tool (§28.5's reasoning) — the loop is a
process the operator runs; but declarations are ordinary claims, so an
agent can declare an automation through `cave_add` and a running loop
serves it from the next cycle.

Part of the [CAVE monorepo](../..); the specification lives in the
repository's `.claude/skills/` directory (spec §29 in
`cave-storage-query`).
