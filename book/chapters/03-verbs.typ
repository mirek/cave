#import "../style.typ": note, file, recap

= Verbs

The verb is the only part of a claim that carries fixed meaning. This chapter
covers the two verbs the language is built on, the standard set worth knowing
by heart, how to declare your own, and the two declarations that make a
vocabulary evolve gracefully: `REVERSE` and `RENAMED-TO`.

== Two verbs are enough to start

CAVE bootstraps from `IS` and `HAS`. `IS` gives a thing a type, a state, or a
bare measurement; `HAS` gives it a property.

```cave
la-cima IS supplier
la-cima HAS country: colombia
roaster/drum IS warming-up
```

Everything else, including the standard verbs and the declarations below, is
defined on top of these two. You could write a useful store with nothing
else. You would just be giving up graph quality: `coffee/morning-blend USES
lot/huila-26` tells a query engine something that `coffee/morning-blend HAS
ingredient: lot/huila-26` does not, because `USES` is a relation between two
entities that can be walked in either direction.

== The standard verbs

The standard set is small and grouped by what it describes. Use one of these
when it fits; the graph gets better every time two claims share a verb.

#table(columns: (auto, auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Family*], [*Verbs*], [*Example*],
  [Identity and taxonomy], [`IS`, `EXTENDS`, `ALIAS`, `LIKE`, `EXISTS`],
    [`natural EXTENDS process`],
  [Causation and change], [`CAUSE`, `FIX`, `BECOMES`],
    [`stale-lot CAUSE flat-taste`],
  [Dependency and production], [`NEEDS`, `USES`, `YIELDS`, `ENABLES`, `BLOCKS`],
    [`roast/light YIELDS coffee/yirgacheffe`],
  [Structure and ordering], [`CONTAINS`, `PRECEDES`, `EXCEEDS`, `VS`],
    [`resting PRECEDES packing`],
  [Qualifiers], [`WHEN`, `UNLESS`, `VIA`, `BECAUSE`],
    [indented under another claim (Chapter 6)],
)

Two conventions keep causal claims readable. Causation runs cause to effect:
`stale-lot CAUSE flat-taste`, never `flat-taste CAUSE stale-lot`. And `ALIAS`
means the same entity under another name, while `LIKE` means similar but
distinct; the store treats them very differently (Chapter 12).

== Declaring your own

When no standard verb fits, declare one. The declaration is itself a claim
on the bootstrap verb, so it lives in the same file as the facts that use
it, and it is stored, exported, and attributed like any other claim:

```cave
SUPPLIES IS verb ; supplier X sells us green coffee lot Y
```

The comment is the verb's documentation and the convention for it is
worth copying: name the two sides as X and Y. You can add more claims about
the verb (`SUPPLIES HAS domain: purchasing`, `SUPPLIES LIKE YIELDS`) if you
want to, but the one line above is all the engine needs. Keep extensions
rare. If an extraction from one document invents more than three new verbs,
the document is probably being modelled too specifically.

A verb you did not declare still works: Chapter 1 used `SUPPLIES` before
declaring it. Declaring it buys you documentation, a place to hang the
reverse name, and a reviewable moment when the vocabulary changed.

== Reverse readings

Every relation can be read from either end. The roastery file declares that
reading for both of its verbs:

```cave
SUPPLIES REVERSE SUPPLIED-BY
STOCKS REVERSE STOCKED-BY
```

Now both spellings query, and the answers come from the same stored rows:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave query --db roastery.db 'la-cima SUPPLIES ?lot'
?lot = lot/huila-26
?lot = lot/santa-ana-26

$ cave query --db roastery.db 'lot/huila-26 SUPPLIED-BY ?who'
?who = la-cima
```

The standard verbs come with their inverses declared: `USES` reads back as
`USED-BY`, `CONTAINS` as `PART-OF`, `CAUSE` as `CAUSED-BY`, `NEEDS` as
`NEEDED-BY`, `PRECEDES` as `FOLLOWS`, and so on. So a question the file never
states directly is still one line:

```sh
$ cave query --db roastery.db 'lot/huila-26 USED-BY ?coffee'
?coffee = coffee/morning-blend
```

What matters is what `REVERSE` does *not* do: it does not create a second
row. The left verb of the declaration is the *primary* direction, and a line
written with the inverse is normalized to primary form before it is stored
or keyed. Write the same fact backwards and you are writing to the same
fact:

```sh
$ echo 'lot/huila-26 SUPPLIED-BY la-cima @ 90% ; contract not yet signed' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave query --db roastery.db 'la-cima SUPPLIES lot/huila-26' --all
la-cima SUPPLIES lot/huila-26
lot/huila-26 SUPPLIED-BY la-cima @ 90% ; contract not yet signed
```

Two rows, one belief series, each shown as it was written: the second row
is now the current belief about one fact with two names. Confidence,
negation, and history all belong to the fact, not to the direction you
happened to read it in.

#note([Why not store both directions?], [Materializing inverses would double
every row, split each fact's belief history in two, and double the work of
resolving contradictions. A reverse reading is a query-time view over an
index the store already has. See spec §5.5 and §13.3.])

== Negation

`NOT` right after the verb negates any relation. It records that something
is *not* the case, which is a different and stronger statement than having
no claim at all:

```cave
cafe/harbour STOCKS NOT coffee/yirgacheffe ; they asked, we said no
roaster/drum IS NOT contaminated @ 95%
```

Negation is stored on the same row as the positive form would be, with a
flag, and it reads back through the inverse just as naturally
(`coffee/yirgacheffe STOCKED-BY NOT cafe/harbour`). Chapter 7 contrasts
negation with *retraction*, which is a positive claim at zero confidence: one
says "this is false", the other says "we no longer assert this".

== Renaming a verb

Vocabularies drift. Suppose the roastery decides `STOCKS` should have been
`CARRIES`. A rename is a directional declaration:

```sh
$ echo 'STOCKS RENAMED-TO CARRIES' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave query --db roastery.db 'cafe/north CARRIES ?coffee'
?coffee = coffee/morning-blend
?coffee = coffee/yirgacheffe
```

The old spelling remains accepted, the new one is preferred, and both
resolve to the *original* verb as the stable storage identity. Claims written
before the rename and after it share one belief history, and nothing in the
store is rewritten. Renames chain linearly (`A RENAMED-TO B`, then `B
RENAMED-TO C`), but they cannot branch, cycle, or collide with a verb that
already exists; the first valid declaration wins. Because the declaration is
a claim with a transaction time, a query asked as of a date before the
rename does not know the new name (Chapter 7 introduces as-of reads).

#recap[`IS` and `HAS` bootstrap everything. Prefer the standard verbs;
declare your own with `X IS verb ; X does what to Y`. `A REVERSE B` makes one
stored fact readable and writable under two names. `NOT` asserts a negative.
`OLD RENAMED-TO NEW` evolves a name without rewriting history.]
