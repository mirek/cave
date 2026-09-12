#import "../style.typ": note, file, recap

= Automations

Rules fire when you run `cave derive`, actions when you call them, and
connect re-maps when a file changes. Nothing yet watches the store. An
*automation* pairs a trigger pattern with steps and fires when new claims
match; `cave automate` is the loop that evaluates them. With connect
feeding one end, sense, model, conclude, act, and record close on one
machine, unattended.

== Declaring an automation

An automation is declared like a rule and named like an action:

#file("automations.cave")
```cave
; whenever a lot runs low, order more

automation/reorder-low-stock HAS automation: `?lot NEEDS reorder => action/reorder` ; low stock triggers a reorder
```

The left side is the trigger: ordinary premises, at least one of them a
pattern, and no bare parameters, because an automation has no caller and
every binding must come from the trigger. The right side is a list of
steps, each one of:

- `action/<name>`: execute the action, its parameters bound from trigger
  variables of the same name;
- `hook/<name>`: run the named hook from the same configuration actions
  use, with the triggering rows on standard input;
- a quoted prompt: send it to an agent, bound variables substituted once, and
  record the agent's CAVE reply.

Prompt substitution reads only template tokens. Inserted values that contain
another variable name or replacement text such as `$&` remain literal.

Like rule text and action bodies, the declaration is pure data. It names
things to run; the commands themselves stay in configuration.

As with rules and actions, the declaration call validates the whole prelude
before using its digest cache. A prelude error appends nothing and declares no
automations; corrected retries work normally without duplicating partial rows.

== Arming, and the first cycle

Rebuild the store from Chapter 18 and declare the automation:

#file("stock.csv")
```csv
lot,kg,roasted
lot/yirgacheffe-26,42,2026-08-20
lot/huila-26,6,2026-08-25
lot/santa-ana-26,15,2026-08-22
```

#file("stock.map.cave")
```cave
?lot HAS stock: ?kg kg
```

#file("rules.cave")
```cave
?lot HAS stock: ?kg, ?kg < 10 kg => ?lot NEEDS reorder ; below ten kilos we reorder
```

#file("actions.cave")
```cave
action/reorder HAS action: `?lot, ?lot NEEDS reorder, ?lot SUPPLIED-BY ?supplier => ?lot HAS order: 30kg, ?supplier NEEDS contact` ; order 30 kg of a lot that ran low
```

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 3 mapped, 0 skipped (unchanged); +3 claim(s)

$ cave derive --db roastery.db rules.cave | tail -n 1
derived: +1 appended, 0 updated, 0 retracted, 0 unchanged (2 pass(es))

$ cave act --db roastery.db --declare actions.cave
declared 1 action(s)

$ cave automate --db roastery.db --declare automations.cave
declared 1 automation(s)

$ cave automate --db roastery.db --once
settled: 0 firing(s) over 1 pass(es); derived +0 appended, 0 updated, 0 retracted
```

The Huila lot already needs a reorder, and the first cycle is quiet. That
is by design: an automation arms at the moment it is declared, and rows
recorded before that are *state*, not *events*. A solution fires only when
it cites at least one row newer than the automation's watermark.

== Something happens

The Santa Ana lot runs low. Overwrite the stock file, connect it, and run
one cycle:

#file("stock.csv")
```csv
lot,kg,roasted
lot/yirgacheffe-26,42,2026-08-20
lot/huila-26,6,2026-08-25
lot/santa-ana-26,4,2026-08-27
```

```sh
$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 1 mapped, 2 skipped (unchanged); +1 claim(s)

$ cave automate --db roastery.db --once
automation/reorder-low-stock: fired 1 solution(s) ; low stock triggers a reorder
  ?lot = lot/santa-ana-26
    action/reorder: ok (+2 appended, 0 updated, 0 unchanged)
settled: 1 firing(s) over 2 pass(es); derived +1 appended, 0 updated, 0 retracted

$ cave query --db roastery.db '?lot HAS order: ?kg'
?lot = lot/santa-ana-26  ?kg = 30kg
```

Read the cycle from the inside. Each pass first fires the store's rules,
incrementally, so the new stock row produced a new `NEEDS reorder`
conclusion. Then every current automation is evaluated; the conclusion is
newer than the watermark, so the solution fired, and the action ran with
`?lot` bound from the trigger, under all of its own checks. The next pass
saw the action's effects, found nothing new to fire, and the cycle settled.
The Huila lot, low since before the declaration, was correctly left alone.

== Why the loop cannot run away

Three rules keep the loop honest. The watermark is appended *before* any
step runs, so a crash between the two loses that batch's outside-world
steps rather than replaying them; a re-run must never re-notify the world.
An automation is deaf to its own echo: rows stamped with its own agent
replies or with the effects of its own action steps are never events for
it, while another automation's output triggers normally, which is how
automations chain. And every write path is idempotent, so a cycle
converges unless something genuinely new keeps arriving; a pair of
automations whose agents keep answering each other with fresh values is a
design error that the pass guard bounds per cycle but cannot prevent.

Each batch reserves a write transaction, refreshes its declaration and
vocabulary, evaluates triggers, and commits the watermark before running
steps. Two runners cannot claim the same batch. A declaration revoked while an
earlier agent runs is checked again before its batch is claimed; already-claimed
steps continue. Agent execution holds no write lock. The `settle` API rejects
caller-owned transactions because a savepoint cannot commit the firing log
before external execution.

The report's `complete` flag requires a quiet final pass and completed rule
derivation. Hitting the pass limit prints `incomplete` and makes `--once` exit
nonzero; retrying keeps committed watermarks, so steps are not replayed. If
rule derivation reaches its separate limit, run `cave derive` with a higher
`--max-passes` before retrying.
Malformed stored rules also make `--once` fail when derivation is enabled;
they appear in the report's `problems` list while valid declarations continue.
`--no-derive` skips rule evaluation and those checks.

Programmatic callers can pass `signal` to `settle` or `watchCycle`. Cancellation
stops further claims and steps and discards late agent replies, while committed
watermarks stay committed; unfinished steps in a claimed batch are not replayed.
Custom completion callbacks must cancel their own work. The daemon yields
between repeated settles so shutdown callbacks can run even on a busy store.

Declaring is arming, and re-declaring after a retraction does not replay
the rows recorded while the automation was off. Retractions fire nothing,
unchanged re-assertions append no row and so fire nothing, and a value
update fires because the new row is the current one.

== Running it

`cave automate` without `--once` is the daemon: one settle cycle at
startup, then a cheap poll of the store's highest transaction every two
seconds, and a cycle whenever it moves. `--once` is one cycle and an exit
code that carries step failures, which is all a cron job needs. `--hooks`
and `--agent` supply the hook configuration and the agent command for
prompt steps, with the same shell contract as `cave ingest`:

// no-test
```sh
$ cave automate --db roastery.db --hooks hooks.json --agent 'claude -p'
watching (poll every 2s, ctrl-c to stop)
```

The loop is deliberately not an MCP tool: it is a process the operator
runs. The *declarations* are ordinary claims, though, so an agent can
declare an automation through an ordinary append and a running loop serves
it from the next cycle.

#recap[`` automation/<name> HAS automation: `trigger => action/x, hook/y, "prompt"` ``
fires its steps for each solution that cites a row newer than
its watermark; rows older than the declaration are state, not events. Each
cycle fires rules, evaluates automations, and repeats until nothing fires.
Watermark first, no self-echo, idempotent writes. `--once` for cron, no
flag for a daemon.]
