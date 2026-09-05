#import "../style.typ": note, file, recap

= Asking Questions

CAVE-Q is the query language, and there is almost nothing to learn: a query
is a claim with holes in it. This chapter walks through variables, wildcards,
filters, reverse and transitive patterns, paging, and the JSON form, and
ends with the SQL escape hatch.

== Patterns

A pattern is a claim in which some slots are `?variables`. The store finds
every current claim that fits and prints the bindings:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave query --db roastery.db '?cafe STOCKS coffee/morning-blend'
?cafe = cafe/north
?cafe = cafe/harbour

$ cave query --db roastery.db '?lot HAS process: ?how'
?lot = lot/yirgacheffe-26  ?how = washed
?lot = lot/huila-26  ?how = natural
?lot = lot/santa-ana-26  ?how = washed
```

A variable can stand in subject, object, or value position. The attribute
name is not a variable slot; ask for a specific attribute. Two or more
variables bind together, one line per solution. When the matched claim
carries a comment, the binding line ends with it after `;`, so the note an
author left next to a claim travels with the answer:

```sh
$ cave query --db roastery.db '?lot HAS score: ?s'
?lot = lot/yirgacheffe-26  ?s = 87
?lot = lot/huila-26  ?s = 84
?lot = lot/santa-ana-26  ?s = 85  ; clean, but nothing remarkable
```

A pattern with no variables asks whether the claim holds, and prints the
matching rows as they were written. An underscore is an anonymous wildcard
for a slot you do not care about:

```sh
$ cave query --db roastery.db 'la-cima SUPPLIES lot/huila-26'
la-cima SUPPLIES lot/huila-26

$ cave query --db roastery.db '_ SUPPLIES lot/huila-26'
la-cima SUPPLIES lot/huila-26
```

Metadata in a pattern narrows it. A tag or a context must be present on the
claim; `NOT` matches only explicitly negated claims:

```sh
$ cave query --db roastery.db '?lot HAS score: ?s @src:cupping/june'
?lot = lot/yirgacheffe-26  ?s = 87
?lot = lot/huila-26  ?s = 84
?lot = lot/santa-ana-26  ?s = 85  ; clean, but nothing remarkable
```

There is no negation-as-failure. "Lots that have no score" is not a pattern;
it is a health check (Chapter 13).

== Filters

A second argument beginning with `WHERE` filters the matches on stored
fields: confidence, a value with its unit, or transaction time.

```sh
$ cave query --db roastery.db '?lot HAS price: ?p' 'WHERE value <= 8.10 USD/kg'
?lot = lot/huila-26  ?p = 7.80 USD/kg
?lot = lot/santa-ana-26  ?p = 8.10 USD/kg

$ cave query --db roastery.db '?lot HAS score: ?s' 'WHERE conf >= 0.9'
?lot = lot/yirgacheffe-26  ?s = 87
?lot = lot/huila-26  ?s = 84
?lot = lot/santa-ana-26  ?s = 85  ; clean, but nothing remarkable
```

`WHERE tx <= 2026-08-01` restricts by when a row was recorded; a date means
the whole UTC day. Timestamps without an offset are UTC on every host.

== Reading backwards

An inverse verb is a valid pattern verb and compiles to the same physical
query as the primary direction (Chapter 3). The two questions below hit the
same rows:

```sh
$ cave query --db roastery.db 'coffee/morning-blend USES ?lot'
?lot = lot/huila-26
?lot = lot/santa-ana-26

$ cave query --db roastery.db 'lot/huila-26 USED-BY ?coffee'
?coffee = coffee/morning-blend
```

== Following a chain

A `+` after the verb follows it for as many hops as it takes. This is how a
question nobody wrote down as a single claim gets answered. Add a small
geography to the store:

#file("regions.cave")
```cave
; where the lots come from, as a containment tree

colombia CONTAINS region/huila
region/huila CONTAINS lot/huila-26
region/huila CONTAINS lot/santa-ana-26
ethiopia CONTAINS region/gedeo
region/gedeo CONTAINS lot/yirgacheffe-26
```

```sh
$ cave add --db roastery.db regions.cave
added 5 claim(s), 0 edge(s)

$ cave query --db roastery.db '?what PART-OF+ colombia'
?what = lot/huila-26
?what = lot/santa-ana-26
?what = region/huila

$ cave query --db roastery.db 'lot/yirgacheffe-26 PART-OF+ ?where'
?where = ethiopia
?where = region/gedeo
```

Transitive matches are computed over current positive edges. They carry no
single row, which is why they print bindings and never a raw line, and why
they cannot be anchored in valid time (Chapter 10). The classic use is a
dependency chain: `?x USES+ core` answers "what breaks if `core` changes".

== Current, all, and the rest

By default a query sees current beliefs: the newest row per claim key,
positive, not retracted. `--all` sees every row instead, which is how you
read history. Three more switches change which rows are in play, and each
has its own chapter: `--as-of` reconstructs belief at a past moment (Chapter
7), `--at` anchors in valid time (Chapter 10), `--resolve` keeps only the
winners among contested facts (Chapter 11), and `--aliases` widens names
through alias links (Chapter 12). They compose: a resolved, alias-aware read
as of last month is one command.

== Paging and JSON

A query page holds a hundred matches by default and at most a thousand. When
there are more, the human output ends with a `next:` token, and `--cursor`
continues the same frozen snapshot:

```sh
$ cave query --db roastery.db '?lot IS lot' --limit 2
?lot = lot/yirgacheffe-26
?lot = lot/huila-26
next: <token>
```

`--json` emits a versioned `cave.query-page` object whose matches carry
the bindings and the full claim record, including its canonical line, id,
transaction, and claim key. It is the form to use from a program:

```sh
$ cave query --db roastery.db '?who SUPPLIES lot/huila-26' --json | head -n 11
{
  "format": "cave.query-page",
  "version": 1,
  "snapshot": "<uuid>",
  "matches": [
    {
      "format": "cave.query-match",
      "version": 1,
      "bindings": {
        "who": "la-cima"
      },
```

== Words, not patterns

A pattern needs a name to start from. When all you remember is wording, a
phrase from a comment, a value, a tag, `cave search` runs the store's
full-text index (no extra service to run) over every claim: subject,
verb, object, attribute name, value text, comment, and the line as written,
so tags, contexts, and inverse spellings match too. The terms are one
literal phrase, and matches print newest first as raw lines, comments
included:

```sh
$ cave search --db roastery.db 'nothing remarkable'
lot/santa-ana-26 HAS score: 85 @src:cupping/june ; clean, but nothing remarkable

$ cave search --db roastery.db washed
lot/santa-ana-26 HAS process: washed
lot/yirgacheffe-26 HAS process: washed
```

`--raw` passes FTS5 `MATCH` syntax through: `AND`, `OR`, `NOT`, `NEAR`,
`prefix*`, and column filters such as `comment:heap`. Words split on
punctuation, so `heap-dump` and "heap dump" are the same phrase, and
`auth/middleware` matches `auth middleware`:

```sh
$ cave search --db roastery.db --raw 'cupping NOT remarkable'
lot/huila-26 HAS score: 84 @src:cupping/june
lot/yirgacheffe-26 HAS score: 87 @src:cupping/june
```

Search reads the whole history, superseded and retracted rows included,
because the index exists to find the wording, not to judge it; once it has
named the entity, a query answers what is currently believed. `--limit`
caps the matches (a hundred by default) and `--json` returns the full
claim records.

== SQL, when you need it

Today's store is an ordinary SQLite file with a documented schema
(Chapter 25), and nothing stops you from opening it. CAVE-Q is the ergonomic layer for
graph questions; SQL is the transparent escape hatch for analysis the
pattern language does not cover. The current-belief query is one join, and
it is worth knowing so that hand-written SQL agrees with the tool:

```sql
SELECT c.* FROM cave_claim c
JOIN (SELECT claim_key, MAX(tx) AS max_tx FROM cave_claim GROUP BY claim_key) latest
  ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx
WHERE c.conf > 0 AND c.negated = 0;
```

#recap[A query is a claim with `?variables`; `_` is a wildcard; a
fully-bound pattern prints the matching rows. Tags and contexts in the
pattern narrow it, `WHERE` filters on confidence, value, and transaction
time. Inverse verbs query the same rows; `VERB+` follows a chain. Default
reads are current belief; `--all`, `--as-of`, `--at`, `--resolve`, and
`--aliases` change the universe and compose. `--json` for programs, SQL for
everything else.]
