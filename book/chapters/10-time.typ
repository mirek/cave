#import "../style.typ": note, file, recap

= Time in the World

Chapter 7 dealt with *transaction time*: when the store learned something.
This chapter adds the other axis, *valid time*: when a claim holds in the
world. The two are independent, and keeping them apart is what lets one
store answer "what did we believe in June about the September price".

== Time contexts

A context whose body looks like a date names a period, and the engine reads
it as a time context. Points name whole calendar periods; ranges join two
points with `..` and may leave either end open:

#table(columns: (auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Context*], [*Covers*],
  [`@2026`], [the whole year],
  [`@2026-08`], [the month],
  [`@2026-08-14`], [the day],
  [`@2026-Q3`], [July to September],
  [`@2026-H2`], [July to December],
  [`@2026-W33`], [the ISO week],
  [`@2026-Q2..2026-Q4`], [April through December, whole periods at both ends],
  [`@2026..`], [from the start of 2026, open-ended],
  [`@..2025`], [through the end of 2025],
)

A time context is an ordinary context in every other respect: it is stored,
exported verbatim, and part of the claim key. A context that does not parse
as a time is simply opaque text, never an error. `@time:2026-Q3` is the
same time context with the recommended prefix.

== Anchoring a query: `--at`

`--at` anchors a query at an instant. A claim applies at that instant when
it has no time context at all (timeless knowledge, which is most of it) or
when one of its time contexts covers it. Everything else is invisible:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ printf '%s\n' \
    'kaffa-coop SUPPLIES lot/guji-26 @2026-Q3..2026-Q4 ; a one-off, this season only' \
    'roastery HAS headcount: 3 @..2025' \
    'roastery HAS headcount: 4 @2026..' \
    | cave add --db roastery.db
added 3 claim(s), 0 edge(s)

$ cave query --db roastery.db 'kaffa-coop SUPPLIES ?lot' --at 2026-08
?lot = lot/yirgacheffe-26
?lot = lot/guji-26

$ cave query --db roastery.db 'kaffa-coop SUPPLIES ?lot' --at 2026-02
?lot = lot/yirgacheffe-26

$ cave query --db roastery.db 'roastery HAS headcount: ?n' --at 2025-06
?n = 3

$ cave query --db roastery.db 'roastery HAS headcount: ?n' --at 2026-06
?n = 4
```

The timeless `lot/yirgacheffe-26` relation matches at both anchors; the
seasonal `lot/guji-26` relation matches only inside its range. The two
headcount claims are a *step function*: consecutive scalar claims whose
ranges tile, with no boundary period repeated, so that exactly one applies
at any instant. Without `--at`, both are current beliefs and both are
returned; the anchor is what turns a pile of dated claims into one answer.

A point anchor is read as the *start* of its period, so `--at 2026` is the
first instant of the year; name a finer period to land inside one. An anchor
that does not parse is an error, not an empty result.

== Trajectories: `A -> B`

Some values move. A trajectory is a value with two numeric endpoints and one
unit, and it interpolates linearly across the claim's single closed range:

```sh
$ echo 'lot/huila-26 HAS price: 7.80 -> 8.60 USD/kg @2026..2027 ; la-cima indexed the contract' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave query --db roastery.db 'lot/huila-26 HAS price: ?p' --at 2026-07
?p = 7.80 USD/kg
?p = 8.197 USD/kg

$ cave query --db roastery.db 'lot/huila-26 HAS price: ?p' --at 2027-06
?p = 7.80 USD/kg
?p = 8.6 USD/kg
```

The first binding is the timeless price from the roastery file, which always
applies. The second is the trajectory evaluated at the anchor: 7.80 at the
start of 2026, 8.60 at the start of 2027, linear in between, and holding at
the end value through the end period. A value-slot variable binds the
interpolated number, while the stored row is returned untouched.

A trajectory is deliberately not one number: its numeric column is empty, so
`WHERE value` filters never match it and fusion skips it. It evaluates only
under `--at`, and only when the claim has exactly one closed range; an open
range or several ranges leave it textual. Endpoints with different units do
not form a trajectory at all. Re-estimating a trajectory under the same
contexts appends to the same belief series, so `--as-of` reconstructs the
earlier estimate.

== Both axes at once

`--as-of` chooses which rows are *believed*; `--at` chooses *when in the
world* they apply. They compose, and so do `--all`, `--aliases`, and
`--resolve`: a universe of rows is fixed first, then the valid-time pass
runs over it. The bitemporal question, "what did we believe on the first of
August about the price in June", is one command with both flags.

Transitive patterns reject `--at`. Hop edges are not valid-time filtered, and
a closure that silently ignored the anchor would be a wrong answer rather
than an approximate one.

#note([Why no formulas], [Earlier drafts sketched values as functions of
time, `(t -> 20B * 1.25^(t - 2025))`. Linear trajectories and tiled step
claims cover the ordinary cases; anything nonlinear belongs in a bounded
external evaluator whose inputs, version, and outputs are themselves
recorded as claims. A store does not execute a lambda stored as knowledge.
See spec §17.5 and §32.])

#recap[A date-like context (`@2026-Q3`, `@2026..2027`, `@..2025`) is a time
context and part of the claim key. `--at <instant>` hides claims whose time
contexts miss the instant; timeless claims always match; tiled scalar
claims form step functions. `A -> B unit` interpolates across a single
closed range under `--at`. `--as-of` and `--at` are orthogonal and compose.]
