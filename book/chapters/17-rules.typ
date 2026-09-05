#import "../style.typ": note, file, recap

= Rules

Everything so far stores, checks, or asks. Nothing concludes. A rule takes
patterns that already match and records a claim nobody wrote, with the
reasons attached. This chapter covers the rule line, how confidence flows
through it, what a derivation leaves behind, and why re-running it is safe.

== The rule line

A rule is a comma-separated conjunction of *premises*, an arrow, and one
*conclusion*. Premises are CAVE-Q patterns or constraints; the conclusion is
an ordinary claim whose slots may be variables. `=>` is the only new token.

#file("rules.cave")
```cave
; what follows from what we already know

DEPENDS-ON IS verb ; coffee X depends on supplier Y
DEPENDS-ON REVERSE SUPPLIES-FOR

?c USES ?lot, ?s SUPPLIES ?lot => ?c DEPENDS-ON ?s ; a coffee depends on whoever supplies its lots
?lot HAS score: ?s, ?s >= 86 => ?lot IS specialty ; 86 and up is specialty grade
?lot HAS stock: ?kg, ?kg < 10 kg => ?lot NEEDS reorder ; below ten kilos we reorder
```

Lines with `=>` are rules; everything else in the file is prelude that is
ingested first. Premises evaluate left to right over current, positive,
non-retracted beliefs, each binding narrowing the next pattern, so inverse
verbs and transitive hops cost nothing extra. A constraint (`?s >= 86`)
tests a variable an earlier premise bound; numeric comparison applies when
both sides are numbers, and a unit on the constraint demands the same unit
on the value. Every variable in the conclusion must be bound by a premise.
`NOT` in a premise matches explicitly negated claims; there is no
negation-as-failure, because "no claim says otherwise" is not evidence.

== Firing

Load the store and the stock levels from Chapter 14, then derive:

#file("stock.csv")
```csv
lot,kg,roasted
lot/yirgacheffe-26,42,2026-08-20
lot/huila-26,6,2026-08-25
lot/santa-ana-26,15,2026-08-22
```

#file("stock.map.cave")
```cave
; one row per lot in the green store

?lot HAS stock: ?kg kg
?lot HAS last-roasted: ?roasted
```

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 3 mapped, 0 skipped (unchanged); +6 claim(s)

$ cave derive --db roastery.db rules.cave
declared 3 rule(s), +2 prelude claim(s)
rule/ab991fceb047: 3 solution(s), +2 appended, 0 updated, 0 retracted, 0 unchanged ; a coffee depends on whoever supplies its lots
rule/8c447ade9060: 1 solution(s), +1 appended, 0 updated, 0 retracted, 0 unchanged ; 86 and up is specialty grade
rule/89c4640b638e: 1 solution(s), +1 appended, 0 updated, 0 retracted, 0 unchanged ; below ten kilos we reorder
derived: +4 appended, 0 updated, 0 retracted, 0 unchanged (2 pass(es))

$ cave query --db roastery.db '?c DEPENDS-ON ?s'
?c = coffee/morning-blend  ?s = la-cima
?c = coffee/yirgacheffe  ?s = kaffa-coop

$ cave query --db roastery.db '?lot NEEDS reorder'
?lot = lot/huila-26
```

The first rule found three solutions but appended two claims: the morning
blend uses two lots from the same supplier, and two solutions concluding
the same claim key produce one conclusion. Rules fire to a fixpoint, so a
conclusion can feed another rule in the next pass.

== Rules are claims, and conclusions carry their reasons

A rule is stored in-band as an attribute claim under `rule/<digest>`,
where the digest is the first twelve hex characters of a hash over the
rule's normalized text; whitespace variants share a digest and re-declaring
an unchanged rule appends nothing. `cave derive --list` shows them, and
`cave derive` with no file fires whatever the store already holds.

Every derived claim is stamped `@src:rule/<digest>`, and the export shows
why it is believed: `BECAUSE` edges to the exact premise rows and a `VIA`
edge to the rule:

```sh
$ cave export --db roastery.db | grep -A2 '^lot/huila-26 NEEDS reorder'
lot/huila-26 NEEDS reorder @src:rule/89c4640b638e
  BECAUSE lot/huila-26 HAS stock: 6 kg @src:connect/stock/lot-huila-26 @src:stock.csv#L3
  VIA rule/89c4640b638e HAS rule: `?lot HAS stock: ?kg, ?kg < 10 kg => ?lot NEEDS reorder` @src:cave-derive ; below ten kilos we reorder
```

The chain runs all the way to a line in a CSV. Derived confidence is the
product of the premise confidences and an optional factor on the
conclusion (`... => ?x NEEDS ?y @ 80%`), the noisy-AND of Chapter 5 under
an explicit independence assumption. When several solutions conclude the
same key, the strongest derivation wins, never the sum, so many weak paths
cannot outvote one good one. Conclusions below a floor (five percent by
default) are not asserted.

A rule's output is one belief series per conclusion, separate from any
hand-written series about the same fact, and rule conclusions sit at the
bottom of the resolution ladder (Chapter 11): a derived claim never
outranks a human's.

== Re-running is safe

Run it again and nothing happens:

```sh
$ cave derive --db roastery.db
rule/ab991fceb047: unchanged premises, skipped ; a coffee depends on whoever supplies its lots
rule/8c447ade9060: unchanged premises, skipped ; 86 and up is specialty grade
rule/89c4640b638e: unchanged premises, skipped ; below ten kilos we reorder
derived: +0 appended, 0 updated, 0 retracted, 0 unchanged (1 pass(es))
```

Two mechanisms make that true. A conclusion equal to its current belief is
skipped, so a loop never accretes identical rows. And each rule records a
*watermark*, the highest transaction it accounted for; a later run re-fires
a rule only when some newer row could extend one of its premises, judged by
shape and deliberately ignoring confidence, so a retraction re-fires the
rules its claim used to feed. `--full` ignores watermarks.

Support is recomputed on every firing. A conclusion the rule no longer
reaches is retracted at zero confidence, and while a rule re-establishes its
derivations they are invisible to premise matching, so a retracted premise
retracts the dependent chain across rules and two derivations cannot keep
each other alive. Restock the Huila lot and the reorder disappears:

#file("stock.csv")
```csv
lot,kg,roasted
lot/yirgacheffe-26,42,2026-08-20
lot/huila-26,36,2026-08-25
lot/santa-ana-26,15,2026-08-22
```

```sh
$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 1 mapped, 2 skipped (unchanged); +2 claim(s)
  note: prelude unchanged, skipped

$ cave derive --db roastery.db
rule/ab991fceb047: unchanged premises, skipped ; a coffee depends on whoever supplies its lots
rule/8c447ade9060: unchanged premises, skipped ; 86 and up is specialty grade
rule/89c4640b638e: 0 solution(s), +0 appended, 0 updated, 1 retracted, 0 unchanged ; below ten kilos we reorder
derived: +0 appended, 0 updated, 1 retracted, 0 unchanged (2 pass(es))

$ cave query --db roastery.db '?lot NEEDS reorder'
no matches
```

`cave derive --retract <rule>` retracts a rule together with everything it
derived; `--dry-run` reports inside a rolled-back transaction; `--aliases`
lets premises match through the alias closure. The MCP `cave_derive` tool
has the same semantics, so an agent can declare rules with an ordinary
append and fire them without leaving the protocol.

#recap[`premise, premise, ?v op value => conclusion ; label` is a rule.
Premises match current positive beliefs left to right; conclusions are
stamped `@src:rule/<digest>` with `BECAUSE` edges to premise rows and a
`VIA` edge to the rule. Confidence multiplies; the strongest derivation
wins. Re-runs are idempotent and watermark-incremental, and lost support
retracts conclusions.]
