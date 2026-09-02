#import "../style.typ": note, file, recap

= Indentation

One claim per line is the rule, and it stays the rule. Indentation does not
break it. An indented line is still a claim; what indentation adds is a
relationship between that claim and the less-indented line above it, its
*parent*. There are three kinds of indented line, told apart by what the
line starts with, plus one shorthand that is not a claim at all.

== Qualifiers

An indented line that starts with `WHEN`, `UNLESS`, `VIA`, or `BECAUSE` is
a *qualifier*. It states a condition, a mechanism, or the evidence for its
parent, and the store records an *edge* from the parent claim to the
qualifier claim:

#file("tasting.cave")
```cave
; the July cupping: what we tasted, and what we think explains it

coffee/morning-blend HAS defect: flat @cafe/harbour @ 70%
  WHEN grinder/harbour HAS burr-age: 14mo
  BECAUSE cupping/july

stale-lot CAUSE flat-taste @ 50%
  UNLESS lot/huila-26 HAS roast-date: 2026-08-10
```

Each qualifier is stored as a claim in its own right, with its own key and
history, and the edge is stored beside it with the role (`WHEN`, `BECAUSE`)
that the verb named. `UNLESS x` is accepted as a spelling of `WHEN NOT x`;
canonical output prefers `WHEN NOT`. A qualifier never inherits anything
from its parent and is not affected by reverse declarations: it is exactly
the claim it says it is.

```sh
$ cave add --db roastery.db roastery.cave tasting.cave
added 38 claim(s), 3 edge(s)
```

Thirty-eight claims because a qualifier is a claim; three edges because that
is how many qualifiers there were. The edges are what make derivation
(Chapter 17) and reports (Chapter 21) able to answer *why is this believed*.

== Continuation

An indented line that starts with a bare verb, one of the ordinary relation
verbs rather than a qualifier verb, is a *continuation*: it inherits the
parent's subject and becomes an independent sibling claim.

```cave
kaffa-coop SUPPLIES lot/yirgacheffe-26
  SUPPLIES lot/guji-26
  SUPPLIES lot/sidama-26
```

That is three claims with the subject `kaffa-coop`. The inherited endpoint
follows the verb's direction: when the continuation uses an inverse verb, the
parent's subject lands in *object* position after canonicalization, so a
block can read naturally in both directions:

#file("guji.cave")
```cave
lot/guji-26 IS lot
  SUPPLIED-BY kaffa-coop
  USED-BY coffee/yirgacheffe
```

```sh
$ cave add --db roastery.db guji.cave
added 3 claim(s), 0 edge(s)

$ cave query --db roastery.db 'kaffa-coop SUPPLIES ?lot'
?lot = lot/yirgacheffe-26
?lot = lot/guji-26

$ cave query --db roastery.db 'coffee/yirgacheffe USES ?lot'
?lot = lot/yirgacheffe-26
?lot = lot/guji-26
```

`SUPPLIED-BY kaffa-coop` under `lot/guji-26` became `kaffa-coop SUPPLIES
lot/guji-26`, which is why the reverse declaration matters: without it a
bare `SUPPLIED-BY` continuation would have no way to know which end to
inherit. Continuation is sugar for writing siblings; it does not qualify
the parent and creates no edge.

== Grouped claims

An indented line that is a complete claim, subject and all, is simply a
claim that happens to be grouped under its parent for readability:

```cave
resting PRECEDES packing
  packing PRECEDES delivery
```

This is the same as writing the two lines at the margin. Use it to keep
related facts visually together in a file; the store does not care.

== Prefix headers

The fourth form is the one the roastery file uses most: an *incomplete*
line followed by indented lines. The incomplete line is a prefix, and every
child completes it:

```cave
lot/huila-26 HAS
  process: natural
  price: 7.80 USD/kg
  score: 84 @src:cupping/june
```

This is three claims, each beginning `lot/huila-26 HAS`. The header is not a
claim and is not stored; a trailing comment on a header is documentation
only. Prefixes nest, and blank lines and comment lines inside them are
transparent:

```cave
lot/huila-26 HAS
  price:
    7.80 USD/kg @2026-Q2
    8.10 USD/kg @2026-Q3
  process: natural
```

The rule that keeps this unambiguous is that only an *incomplete* line can
be a prefix. As soon as the accumulated line is a complete claim, its
indented children are qualifiers, continuations, or grouped claims as above.
`cave parse` counts headers separately, which is what the `prefix` figure in
its summary means.

== What canonical output looks like

`cave export` prints a store as canonical text, and canonical text uses the
same four forms. Adjacent sibling claims are factored through their shared
prefix, qualifier edges are rendered as indented qualifier lines, and
everything else is one claim per line:

```sh
$ cave export --db roastery.db | sed -n '/^coffee\/morning-blend HAS defect/,/^stale-lot/p'
coffee/morning-blend HAS defect: flat @cafe/harbour @src:cli @ 70%
  WHEN grinder/harbour HAS burr-age: 14mo @src:cli
  BECAUSE cupping/july @src:cli
stale-lot CAUSE flat-taste @src:cli @ 50%
```

The exported text is the interchange format: `cave import` reads it back,
edges included, and produces an equivalent store. The store is a graph; the
text is a tree-shaped projection of it, and where a shared row is cited by
several parents the export simply restates it (Chapter 24 covers the exact
rules).

#recap[An indented `WHEN`/`UNLESS`/`VIA`/`BECAUSE` line is a qualifier and
creates an edge. An indented bare verb is a continuation that inherits the
parent's subject (in object position for an inverse verb). An indented full
claim is grouped, nothing more. An incomplete line followed by children is a
prefix header that is expanded, not stored.]
