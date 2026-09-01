#import "../style.typ": note, file, recap

= Actions

Rules fire on their own. A decision should not. An *action* is a named
write that a caller invokes with parameters, that checks its preconditions
against current belief, and that appends its effects atomically or not at
all. It is how a human at the terminal or an agent over MCP records a
decision without a free-form append.

== Declaring an action

An action is declared like a rule, as one attribute claim whose value is
the body, under a stable name:

#file("actions.cave")
```cave
; governed writes: the only way an order gets recorded
action/reorder HAS action: `?lot, ?lot NEEDS reorder, ?lot SUPPLIED-BY ?supplier => ?lot HAS order: 30kg, ?supplier NEEDS contact` ; order 30 kg of a lot that ran low
action/reorder/lot IS param ; the lot to reorder
```

The body is the rule line with three additions. A bare variable on the
left (`?lot`) is a *parameter* the caller supplies. The right side may list
several effects. And an effect's `@ N%` is the confidence it is asserted
with, not a product of premise confidences: an action is the caller's
assertion, and its premises are gates, not evidence. The companion claim
`action/reorder/lot IS param` documents the parameter; its comment surfaces
in `cave act --list` and in the MCP tool schema.

The name is the identity. Redeclaring appends to the same claim key, so an
action has exactly one current definition and its evolution is an ordinary
belief series. Retracting the declaration disables the action; effects of
past executions were true when recorded and stay.

== Executing

Set up the store from Chapter 17, with the Huila lot low and the reorder
rule fired:

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

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 3 mapped, 0 skipped (unchanged); +3 claim(s)

$ cave derive --db roastery.db rules.cave
declared 1 rule(s)
rule/89c4640b638e: 1 solution(s), +1 appended, 0 updated, 0 retracted, 0 unchanged ; below ten kilos we reorder
derived: +1 appended, 0 updated, 0 retracted, 0 unchanged (2 pass(es))

$ cave act --db roastery.db --declare actions.cave
declared 1 action(s), +1 prelude claim(s)
```

Now execute it, twice, and then try it on a lot that does not need
reordering:

```sh
$ cave act --db roastery.db reorder lot=lot/huila-26
executed action/reorder: +2 appended, 0 updated, 0 unchanged (1 solution(s))
  appended: lot/huila-26 HAS order: 30kg
  appended: la-cima NEEDS contact

$ cave act --db roastery.db reorder lot=lot/huila-26
executed action/reorder: +0 appended, 0 updated, 2 unchanged (1 solution(s))
  unchanged: lot/huila-26 HAS order: 30kg
  unchanged: la-cima NEEDS contact

$ cave act --db roastery.db reorder lot=lot/santa-ana-26
cave act: precondition failed — no current belief satisfies "?lot NEEDS reorder"
[exit 1]
```

Execution follows a fixed sequence. The current declaration is resolved and
parsed. Arguments are validated: every parameter supplied, no unknown
names, values formatted exactly as connect formats record fields. Premises
evaluate left to right with the parameters pre-bound; a premise with no
solution fails the action and nothing is appended, which is what the third
call shows. Variables used in effects must bind uniquely across the
surviving solutions; an ambiguous binding fails too, because an action
executes once, deterministically, or not at all. Then the effects append in
one transaction. The second call appended nothing because every effect
already equalled its current belief.

== What an execution leaves behind

Effects are stamped `@src:action/<name>` and carry lineage: `BECAUSE`
edges to the premise rows of the justifying solution and a `VIA` edge to
the declaration. The reasoning nests all the way down:

```sh
$ cave export --db roastery.db | grep -A6 '^lot/huila-26 HAS order'
lot/huila-26 HAS order: 30kg @src:action/reorder
  BECAUSE
    lot/huila-26 NEEDS reorder @src:rule/89c4640b638e
      BECAUSE lot/huila-26 HAS stock: 6 kg @src:connect/stock/lot-huila-26 @src:stock.csv#L3
      VIA rule/89c4640b638e HAS rule: `?lot HAS stock: ?kg, ?kg < 10 kg => ?lot NEEDS reorder` @src:cave-derive ; below ten kilos we reorder
    la-cima SUPPLIES lot/huila-26 @src:cli
  VIA action/reorder HAS action: `?lot, ?lot NEEDS reorder, ?lot SUPPLIED-BY ?supplier => ?lot HAS order: 30kg, ?supplier NEEDS contact` @src:cave-act ; order 30 kg of a lot that ran low
```

An order, because the lot needed reordering, because its stock was six
kilos on line 3 of a CSV, through a named rule; and because la-cima supplies
it, through a named action. Nobody wrote a sentence of that.

== The gate, and hooks

Actions run inside the shape gate of Chapter 13 by default: if an
execution would introduce a new `EXPECTS` violation, it rolls back.
`--no-check` opts out, and `--dry-run` reports inside a rolled-back
transaction without firing anything.

A decision recorded in the store often needs to reach the outside world.
Executable content must never live in the store, so the action *names* a
hook and the command lives in configuration:

#file("hooks.json")
```json
{ "purchase": "cat >> purchase-orders.log" }
```

```sh
$ echo 'action/reorder HAS hook: purchase' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ printf 'lot/santa-ana-26 HAS stock: 4 kg\n' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave derive --db roastery.db | tail -n 1
derived: +1 appended, 0 updated, 0 retracted, 1 unchanged (2 pass(es))

$ cave act --db roastery.db reorder lot=lot/santa-ana-26 --hooks hooks.json
executed action/reorder: +1 appended, 0 updated, 1 unchanged (1 solution(s))
  appended: lot/santa-ana-26 HAS order: 30kg
  unchanged: la-cima NEEDS contact
hook purchase: ok

$ cat purchase-orders.log
lot/santa-ana-26 HAS order: 30kg
```

The hook runs strictly *after* the commit, with the appended claims as CAVE
text on standard input and `{action}` and `{param}` placeholders
substituted shell-quoted. A failing hook cannot un-happen recorded
knowledge; it is reported with the claims intact. A hook that is named but
not configured is reported as not fired, which makes running without hook
configuration a legitimate side-effect-free mode. Idempotent no-op
executions and dry runs never fire hooks, so a loop never re-notifies the
world about claims that did not change. Hook configuration comes from
`--hooks`, or `$CAVE_HOOKS`.

== Serving actions to agents

`cave mcp` generates one tool per current action, `act_<name>`, with the
declaration comment as description and the parameters as a schema (Chapter
23). Agents then get a vocabulary of allowed writes with validated
preconditions, atomic appends, and provenance, instead of free-form
`cave_add`, and the MCP client's ordinary permission prompt is where a human
confirms.

#recap[`` action/<name> HAS action: `?param, premise => effect, effect` ``
declares a governed write. Execution validates parameters, requires every
premise to match current belief, needs unique bindings, appends effects
atomically with `@src:action/<name>` and lineage, is idempotent, and runs
inside the shape gate. `HAS hook: <name>` names an out-of-band command that
runs after commit. Actions become `act_<name>` MCP tools.]
