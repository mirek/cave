# @cavelang/rules

The CAVE rules engine (spec §24): forward-chaining `premises =>
conclusion` rules over current beliefs — CAVE's transform layer, with
derivation lineage and incrementality falling out of the storage model.
This is the Draft §17.4 grammar proven out and committed.

```cave
?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z
?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian
?x PRECEDES ?event, ?x CONTAINS ?change => ?change CAUSE ?event @ 50%
```

Premises are ordinary CAVE-Q patterns (§12.1) — inverse verbs,
transitive `VERB+` hops, `NOT`, `@ctx`/`#tag` filters all work — plus
`?var op value` constraints. The conclusion is an ordinary claim line;
its `@ N%` is the rule's confidence factor.

```ts
import { declareRules, derive } from '@cavelang/rules'

declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
derive(store)
// → appends `a NEEDS c @src:rule/4a0bb974f43c @ 72%`, linked BECAUSE to
//   the two premise rows and VIA to the rule's declaration row
```

Or from the CLI:

```sh
cave derive --db k.db rules.cave     # declare the file's rules, then fire
cave derive --db k.db                # fire what the store already knows
cave derive --db k.db --list
cave derive --db k.db --retract 4a0bb974f43c
```

## What firing means (§24.2–§24.5)

- **Rules are in-band claims** — `rule/<digest> HAS rule: `…``, digest =
  SHA-256/12 of the normalized text — so declaring, listing, retracting
  and *pointing lineage at* rules is ordinary belief evolution.
- **Forward chaining to fixpoint** over current, positive, non-retracted
  beliefs; each join step specializes the next pattern with the bindings
  so far and runs it through the ordinary CAVE-Q compiler.
- **Confidence is noisy-AND** (`@cavelang/fusion`, the independence
  assumption explicit): rule conf × Π premise-row confs; several
  derivations of one conclusion keep the strongest.
- **Lineage on `cave_edge`**: derived rows point `BECAUSE` at their
  specific premise rows and `VIA` at the rule — `cave export` renders
  the whole derivation tree, and import replays it.
- **Idempotent and incremental**: unchanged conclusions append nothing;
  per-rule `derive-watermark` claims let a run skip rules no new row
  could affect (`--full` overrides).
- **Support is well-founded**: premises retracted → dependents retracted,
  cascading across rules within the run; mutually-supporting derivation
  cycles cannot keep each other alive.
- `--dry-run` computes the full report inside a rolled-back transaction.

Derived claims are stamped `@src:rule/<digest>` (§9.5), so a rule's
output keeps its own belief series per conclusion — a hand-written claim
about the same fact coexists (§9.4) and is never silently overridden.

See the spec's §24 (`.claude/skills/cave-storage-query`) for the
normative semantics, and `test/` for executable examples.
