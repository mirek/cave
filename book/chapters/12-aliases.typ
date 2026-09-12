#import "../style.typ": note, file, recap

= One Entity, Many Names

Chapter 2 asked you to spell every entity the same way everywhere. Real
stores do not manage it: a colleague writes `la-cima-coop`, an extraction
writes `La Cima`, and the graph quietly splits. This chapter covers `ALIAS`,
the closure that lets a query see through it, and the discovery command that
finds candidates for you.

== Declaring an alias

`ALIAS` asserts that two names denote one entity. It is an ordinary claim,
and it is undirected in effect: either spelling of the link is enough.

Suppose later notes used a longer name for the Colombian supplier:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ printf '%s\n' \
    'la-cima-coop HAS contact: "Ana Ruiz"' \
    'la-cima-coop SUPPLIES lot/tolima-26' \
    'lot/tolima-26 IS lot' \
    | cave add --db roastery.db
added 3 claim(s), 0 edge(s)

$ cave query --db roastery.db 'la-cima SUPPLIES ?lot'
?lot = lot/huila-26
?lot = lot/santa-ana-26
```

The new lot is invisible under the old name. Link the names and ask again
with `--aliases`:

```sh
$ echo 'la-cima-coop ALIAS la-cima' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave query --db roastery.db 'la-cima SUPPLIES ?lot' --aliases
?lot = lot/huila-26
?lot = lot/santa-ana-26
?lot = lot/tolima-26
```

== The closure

Alias-aware reading computes the *alias closure*: the set of names connected
by current, positive `ALIAS` claims, read as undirected edges. Matching then
widens to every name in the group. Three properties matter:

- *Rows are never rewritten.* The store does not pick a canonical spelling
  and does not merge anything; it returns the stored spelling. That is why
  the result above still says `la-cima` on the left and why the new lot's
  own claim still names `la-cima-coop`.
- *Series stay separate.* Aliased names keep their own belief histories.
  When they disagree, the closure surfaces both claims rather than hiding
  one; `cave check` reports such disagreements (Chapter 13).
- *It is opt-in.* Every reader that can widen through aliases does so only
  when asked: `--aliases` on queries, reports, resolution, derivation, and
  action preconditions.

The closure applies to entity positions only. Values, attribute names, and
verbs are not entities; verb spellings resolve through `RENAMED-TO` instead
(Chapter 3). Negated aliases (`a ALIAS NOT b`), retracted aliases, and
aliases whose endpoint is a literal never link. Unmerging is a retraction:
append `la-cima-coop ALIAS la-cima @ 0%` and the two names fall apart again,
both histories intact.

== Finding candidates

Naming drift is the entity-resolution bottleneck under extraction, and
discovering the pairs is the hard part. `cave suggest-alias` finds candidate
pairs using explainable signals and prints `ALIAS` claims at low confidence
for review. `--min` accepts a finite score in 0..1 or a percentage; `--limit`
requires a positive safe integer. Rebuild the store without the alias to see
what it finds:

```sh
$ cave add --db fresh.db roastery.cave
added 33 claim(s), 0 edge(s)

$ printf '%s\n' 'la-cima-coop HAS contact: "Ana Ruiz"' 'la-cima-coop SUPPLIES lot/tolima-26' | cave add --db fresh.db
added 2 claim(s), 0 edge(s)

$ cave suggest-alias --db fresh.db
lot/yirgacheffe-26 ALIAS lot/santa-ana-26 #suggested @ 45% ; share process: washed; both IS lot
la-cima-coop ALIAS la-cima #suggested @ 35% ; segments of la-cima within la-cima-coop; la-cima prefixes la-cima-coop
```

One suggestion is right and one is wrong, which is the normal shape of the
output. The second comes from name similarity: `la-cima` is contained in
`la-cima-coop`. The first comes from a shared rare attribute value: exactly
two lots are `washed`, and a textual value carried by exactly two entities
is treated as a possible identity. The comment carries the evidence so a
reviewer can judge it. Suggestions are always between 30 and 50 percent,
inside the review band that `cave check` flags, and they are questions, not
merges.

Both review moves are ordinary appends. Confirm by asserting the link in
your own series; reject by negating it:

```sh
$ printf '%s\n' 'la-cima-coop ALIAS la-cima ; confirmed' 'lot/yirgacheffe-26 ALIAS NOT lot/santa-ana-26 ; different lots' | cave add --db fresh.db
added 2 claim(s), 0 edge(s)

$ cave suggest-alias --db fresh.db
no alias suggestions
```

A pair with any `ALIAS` history, positive, negated, or retracted, is never
suggested again. The decision sticks, and the store never nags. Signals are
deliberately guarded: names that differ only in digits are versions, not
drift; numeric values never identify; a value shared by three or more
entities is a category, not an identity; and shared relations only
strengthen a candidate, never create one, because siblings share parents
without being one person.

Suggested lines preserve entity identity. An undirected link may reverse to
`42 ALIAS 4-2`, keeping `42` out of the numeric object position. The preferred
name in suggestion metadata is unchanged. If neither direction can represent
an entity object, discovery reports an error without writing.

`--write` stamps suggestions `@src:suggest/alias`. Under one transaction, it
skips pairs with history in either direction, preserving reviews committed
while a judge runs. Every fresh line must describe one positive alias relation
between its proposed names; a mismatch rejects the whole batch.
`--json` returns the selected suggestions; `--json --write` also writes and
reports the actual appended count. Alias-aware reads honour written suggestions
until reviewed: retract their series using the same direction and source context. An optional
`--agent` judges candidates using the ingestion shell contract (Chapter 15).

#recap[`a ALIAS b` links two names for one entity; `--aliases` widens
matching through the closure without rewriting rows or merging histories.
Unmerge by retracting. `cave suggest-alias` proposes candidates from
explainable signals at review-band confidence; confirm with a plain `ALIAS`,
reject with `ALIAS NOT`, and the pair is never suggested again.]
