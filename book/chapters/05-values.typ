#import "../style.typ": note, file, recap

= Values, Units, and Uncertainty

Attribute values are where CAVE meets numbers. This chapter explains how a
value is written, how units and multipliers are read, how to say that a
measurement is approximate or has a spread, and why that spread is a
different thing from confidence.

== Typed values

A value is a number, a number with a unit, a date-like token, a name, or a
literal. The parser stores the original text and, when it can, a parsed
number and a normalized unit beside it:

```cave
lot/huila-26 HAS price: 7.80 USD/kg
lot/huila-26 HAS moisture: 10.8%
kaffa-coop HAS capacity: 120K kg/yr
roaster/drum HAS warm-up: 25min
lot/huila-26 HAS harvest: 2026-Q1
```

The rules are few. A simple unit glues to its number (`25min`, `205C`,
`3600s`); a compound unit takes a space (`7.80 USD/kg`, `120K kg/yr`); a
slash inside a unit means "per"; `%` is a unit; and the multipliers `K`,
`M`, `B`, and `T` scale the number so that `120K` is stored as 120000 and
`2.5B` as 2500000000. Units the engine has never seen pass through verbatim,
so `205 C` and `18 bags` work without registration.

== Comparing values in queries

Because numbers and units are parsed at write time, a query can compare
them. `WHERE value` takes an operator and a value, unit included:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave query --db roastery.db '?lot HAS price: ?p' 'WHERE value < 9 USD/kg'
?lot = lot/huila-26  ?p = 7.80 USD/kg
?lot = lot/santa-ana-26  ?p = 8.10 USD/kg

$ cave query --db roastery.db '?lot HAS score: ?s' 'WHERE value >= 85'
?lot = lot/yirgacheffe-26  ?s = 87
?lot = lot/santa-ana-26  ?s = 85  ; clean, but nothing remarkable
```

Comparisons require compatible units: a filter in `USD/kg` never matches a
value in `EUR/kg`, and no conversion is attempted. Conversions are policy,
and CAVE keeps policy out of the storage layer.

== Approximate values: `~`

A tilde before a value marks it as approximate. The number is still parsed
and still comparable; the flag records that nobody measured it precisely:

```cave
kaffa-coop HAS capacity: ~120K kg/yr
cafe/north HAS weekly-volume: ~40 kg/wk
```

== Spread: `+/- delta`

When a measurement has a known spread, write it with `+/-` and the same
unit. The default reading is two standard deviations, which matches how
people say "ten point eight, plus or minus point three":

```cave
lot/huila-26 HAS moisture: 10.8% +/- 0.3%
lot/yirgacheffe-26 HAS density: 0.72 g/ml +/- 0.02 g/ml (1σ)
```

The optional `(Nσ)` says which level the delta is quoted at. If the interval
is Δ at kσ, then σ is Δ/k; the store keeps the delta text, the parsed delta,
and the sigma level as separate columns so a later computation can use them.

== Two kinds of uncertainty

This is the idea worth slowing down for. A value's spread is *aleatory*
uncertainty: the quantity itself is imprecise. A claim's confidence is
*epistemic* uncertainty: how much you believe the assertion. They are
independent, and CAVE writes them in different places so they never get
confused:

```cave
; sure of the measurement, which is itself imprecise
lot/huila-26 HAS moisture: ~10.8% +/- 0.3% @src:meter @ 95%

; a precise number from a source we do not trust much
lot/huila-26 HAS moisture: 11.4% @src:la-cima/email @ 30%
```

The first line says: we measured it ourselves, the meter is not very precise,
and we are nearly certain of the reading. The second says: someone told us a
suspiciously exact number. A reader, human or program, can weigh those two
lines properly only because the language kept the two uncertainties apart.

#note([Fusing estimates], [Given several estimates of one quantity, each with
a spread and a confidence, a precision-weighted average gives a fused value
and spread; confidence acts as a weight. The MCP server offers this as the
`cave_fuse` tool so that agents do not do the arithmetic in tokens. The math
is spec §10.1; it is an implementation layer, not syntax.])

== Competing hypotheses

Numbers are not the only place uncertainty lives. When several explanations
compete, give each its own entity rather than overwriting one claim, so that
new evidence can update each hypothesis separately:

```cave
stale-lot CAUSE flat-taste @ 50%
grinder/harbour CAUSE flat-taste @ 30%
water/harbour CAUSE flat-taste @ 20%
```

The confidences of an exhaustive set should sum to about 100 percent. When
the grinder is serviced and the taste does not change, append a new
assessment for each line; the old ones remain in the history, which is the
subject of Chapter 7.

== What a trajectory is

One more value form exists, and it belongs to time: `A -> B` names a value
that moves from one number to another across a time range, such as `price:
7.80 -> 8.60 USD/kg @2026..2027`. Chapter 10 introduces it together with the
query that reads it at an instant.

#recap[Values carry parsed numbers and normalized units, so `WHERE value`
compares them, but only within one unit. `~` marks an approximate value,
`+/- delta (Nσ)` a spread. Spread is about the quantity; `@ N%` is about the
claim. Keep competing hypotheses as separate entities.]
