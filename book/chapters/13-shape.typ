#import "../style.typ": note, file, recap

= Shape and Health

A store accepts any claim about anything, and it should: the world does not
announce its schema in advance. But once you know what a well-described lot
looks like, you want to be told when one is missing a price. This chapter
covers `EXPECTS`, the health report, the write gate, and the typed client
you can generate from the same declarations.

== Expectations are claims

`EXPECTS` declares what instances of a type should carry. The object is an
attribute name (lowercase) or a verb (uppercase):

#file("shapes.cave")
```cave
; what a well-described record looks like
lot EXPECTS price #unit:USD/kg
lot EXPECTS score
lot EXPECTS SUPPLIED-BY #cardinality:one
coffee EXPECTS USES
cafe EXPECTS STOCKS
```

An entity is an instance of `lot` when it has a current positive `IS lot`
claim, or an `IS` claim into a type that `EXTENDS+` into `lot`. The taxonomy
is the only widening mechanism; there are no name globs. An attribute
expectation is met by a current positive `HAS attr:` claim; a relation
expectation by a current positive claim with that verb on the side the verb
reads from, so `SUPPLIED-BY` is satisfied by a stored `SUPPLIES` row that
names the lot as object.

Two tags narrow an expectation without a second schema language.
`#cardinality:one` requires exactly one current match, which matters mainly
for relations, since an attribute already has at most one current value per
series. `#unit:USD/kg` requires the current value's normalized unit to be
exactly that; no conversion is attempted and a unitless value fails.

Expectations evolve like every claim: retract one with `@ 0%`, and a negated
declaration documents a deliberate non-expectation. They never constrain
writes by default.

== The health report

`cave check` reads the store against its own expectations and reports,
without writing anything:

```sh
$ cave add --db roastery.db roastery.cave shapes.cave
added 38 claim(s), 0 edge(s)

$ cave check --db roastery.db
shape: 5 expectation(s), 7 instance(s), 13/13 satisfied
coverage: 38 row(s), 38 fact(s) — 38 current, 0 retracted, 0 negated; avg conf 100%, 0 low (< 0.3); 16 entities, 9 typed
```

Every lot has a price in the right unit, a score, and exactly one supplier;
every coffee uses something; every cafe stocks something. Now a new lot
arrives with only a type:

```sh
$ echo 'lot/tolima-26 IS lot' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave check --db roastery.db
shape: 5 expectation(s), 8 instance(s), 13/16 satisfied
violations (3):
  lot/tolima-26 missing attribute price (lot/tolima-26 IS lot; lot EXPECTS price #unit:USD/kg)
  lot/tolima-26 missing attribute score (lot/tolima-26 IS lot; lot EXPECTS score)
  lot/tolima-26 missing relation SUPPLIED-BY (lot/tolima-26 IS lot; lot EXPECTS SUPPLIED-BY #cardinality:one)
coverage: 39 row(s), 39 fact(s) — 39 current, 0 retracted, 0 negated; avg conf 100%, 0 low (< 0.3); 17 entities, 10 typed
```

The command exits with status 1 while a violation remains, so it works as a
CI gate. The other sections are advisory: *stale* current beliefs older than
a horizon (`--stale <days>`, default 90), *review candidates* with
confidence between 30 and 70 percent, and *alias disagreements*, where two
names in one alias group carry different current values or opposite
polarity for the same fact. The coverage line is the intrinsic measure of a
store's quality: how much is typed, how much is retracted, how confident
the current beliefs are on average.

== The write gate

The same check can run inside an append. `cave add --check` appends, checks,
and rolls back if the append *introduced* violations that were not there
before:

```sh
$ echo 'lot/tolima-27 IS lot' | cave add --db roastery.db --check
rejected: 3 new violation(s), nothing added (spec §20.3)
  lot/tolima-27 missing attribute price (lot/tolima-27 IS lot; lot EXPECTS price #unit:USD/kg)
  lot/tolima-27 missing attribute score (lot/tolima-27 IS lot; lot EXPECTS score)
  lot/tolima-27 missing relation SUPPLIED-BY (lot/tolima-27 IS lot; lot EXPECTS SUPPLIED-BY #cardinality:one)
```

Pre-existing violations never block: the gate compares, it does not demand a
clean store, so the unfinished `lot/tolima-26` does not stop unrelated
progress. Actions (Chapter 18) run inside the same gate by default. One
mechanism, two enforcement points.

To satisfy the gate, describe the lot fully in one append:

```sh
$ printf '%s\n' 'lot/tolima-26 HAS price: 7.95 USD/kg' 'lot/tolima-26 HAS score: 85.5 @src:cupping/august' 'la-cima SUPPLIES lot/tolima-26' | cave add --db roastery.db --check
added 3 claim(s), 0 edge(s)

$ cave check --db roastery.db
shape: 5 expectation(s), 8 instance(s), 16/16 satisfied
coverage: 42 row(s), 42 fact(s) — 42 current, 0 retracted, 0 negated; avg conf 100%, 0 low (< 0.3); 17 entities, 10 typed
```

== A typed client

Applications that want compile-time ergonomics can derive a TypeScript
module from the current expectations. CAVE text and CAVE-Q stay the primary
interfaces; the generated file is a build artifact:

```sh
$ cave generate --db roastery.db | head -8
// Generated by CAVE typed-client/v1; do not edit.
// Schema SHA-256: <hex>
import { QuerySql, type Store } from '@cavelang/store'

export const caveClientFormatVersion = 1 as const
export const caveSchemaDigest = "<hex>" as const
export const caveSchema = [
  {
```

Each type becomes an interface and a `read<Type>(store, entity)` function.
Attribute readers keep the text, the parsed number, and the unit, with
`#unit:` narrowing the unit to a literal type; relation readers honour
declared inverses; `#cardinality:one` fields are scalars that throw unless
exactly one current row exists, and everything else is a readonly array.
The output is sorted by code point and embeds a digest of the normalized
schema, so it is byte-stable across declaration order and locale, and
generation fails before writing when declarations conflict or a type name
cannot map to a TypeScript identifier.

#recap[`type EXPECTS attribute` and `type EXPECTS VERB` declare shape as
claims, bound through the `IS`/`EXTENDS` taxonomy, with `#cardinality:one`
and `#unit:<u>` as the only constraints. `cave check` reports violations
(exit 1), stale beliefs, review candidates, alias disagreements, and
coverage. `cave add --check` and actions roll back appends that introduce
new violations. `cave generate` derives a deterministic typed client.]
