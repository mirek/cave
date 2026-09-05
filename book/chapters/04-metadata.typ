#import "../style.typ": note, file, recap

= Context, Tags, and Confidence

A three-word claim says *what*. The metadata after it says *where*, *from
whom*, *how surely*, and *filed under what*. This chapter introduces the four
qualifiers that most claims end up carrying, and the one rule that decides
which of two similar mechanisms to use.

Here is the full anatomy of a line, with every optional piece present:

```text
subject VERB object +/- delta @context #tag @ 90% ! ; comment
│       │    │      │         │        │    │     │  │
│       │    │      │         │        │    │     │  └ persisted prose
│       │    │      │         │        │    │     └ importance marker
│       │    │      │         │        │    └ claim confidence
│       │    │      │         │        └ tag: flat #tag or scoped #key:value
│       │    │      │         └ scope, location, time, or source
│       │    │      └ value uncertainty (Chapter 5)
│       │    └ the object, or attribute: value
│       └ relationship (UPPERCASE)
└ the subject
```

All suffixes are optional. Contexts and tags may repeat.

== Context: `@name`

A context scopes a claim. It is an `@` immediately followed by a name, with
no space:

```cave
lot/huila-26 HAS score: 84 @src:cupping/june
coffee/morning-blend HAS defect: flat @cafe/harbour
roaster/drum HAS temperature: 205 C @time:2026-08-14T07:30Z
```

Four prefixes are recommended because tools read them: `@src:` names the
source a claim came from, `@time:` an event time, `@loc:` a location, and
`@scope:` a logical partition. Bare contexts like `@production` or
`@cafe/harbour` are fine too. A date-like context, bare or after `@time:`,
is a *time context* that valid-time queries understand (Chapter 10).

Context is part of a claim's identity. `lot/huila-26 HAS score: 84
@src:cupping/june` and the same score `@src:cupping/july` are two facts with
two histories, not one fact stated twice. That is exactly what you want for
sources: two graders can disagree, and the store keeps both (Chapter 11
shows how to pick a winner when you need one).

== Tags: `#tag` and `#key:value`

A tag classifies the claim. It is flat (`#organic`) or scoped
(`#certification:organic`); a flat tag is a scoped tag with no value.

```cave
lot/yirgacheffe-26 HAS certification: organic #verified @src:kaffa-coop/docs
lot/santa-ana-26 HAS defect: quakers #severity:low @src:cupping/june
```

Tags filter queries directly. Load the store and ask for verified
certifications, then for every low-severity defect:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ printf '%s\n' \
    'lot/yirgacheffe-26 HAS certification: organic #verified @src:kaffa-coop/docs' \
    'lot/huila-26 HAS certification: organic @src:la-cima/email' \
    'lot/santa-ana-26 HAS defect: quakers #severity:low @src:cupping/june' \
    | cave add --db roastery.db
added 3 claim(s), 0 edge(s)

$ cave query --db roastery.db '?lot HAS certification: organic #verified'
?lot = lot/yirgacheffe-26

$ cave query --db roastery.db '?lot HAS defect: ?d #severity:low'
?lot = lot/santa-ana-26  ?d = quakers
```

Tags are stored beside the claim, not in its identity, and they carry no
history of their own. Which brings us to the rule.

== The two-lane rule

CAVE has two ways to classify, and they answer different questions. An
*entity facet* is an attribute claim: `lot/huila-26 HAS topic: colombia`. It
classifies the entity, and because it is a claim it has its own belief
history and can be retracted later. A *claim facet* is a tag:
`... #topic:colombia`. It files the claim, and it has no life of its own.

The writer's test is: *does this classification deserve its own history?* A
lot's certification can be granted and later withdrawn, so it is an
attribute. A note that this particular score belongs to the June cupping is
about the claim, so it is a tag or a context. Collapsing the two would force
spurious history onto tags or strip entity memberships of theirs.

Topics follow from the rule without new syntax. A topic is an ordinary
entity, conventionally under `topic/`, and membership is `CONTAINS`:

```cave
topic/ethiopia IS topic
topic/ethiopia CONTAINS kaffa-coop
topic/ethiopia CONTAINS lot/yirgacheffe-26
```

Since `CONTAINS` has the inverse `PART-OF`, "which topics is this lot in" is
a query with no extra rows.

== Confidence: `@ N%`

A space after the `@` and a trailing `%` make a confidence, and the space is
the whole difference between it and a context:

```cave
coffee/morning-blend HAS defect: flat @cafe/harbour @ 70% ; two complaints this week
```

Omitted confidence means 100 percent: directly observed, certain for
practical purposes. The scale is meant to be used coarsely:

#table(columns: (auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Confidence*], [*Reading*],
  [`@ 100%`], [Directly observed; the default, so omit it.],
  [`@ 90%`], [High confidence, reliable source.],
  [`@ 70%`], [Likely; several signals agree.],
  [`@ 50%`], [Could go either way.],
  [`@ 30%`], [Unlikely but plausible.],
  [`@ 0%`], [Rejected. Also how a claim is retracted (Chapter 7).],
)

Confidence filters queries with a `WHERE` line, passed as a second argument:

```sh
$ printf '%s\n' \
    'coffee/morning-blend HAS defect: flat @cafe/harbour @ 70% ; two complaints this week' \
    'coffee/morning-blend HAS defect: sour @cafe/north @ 20% ; one vague remark' \
    | cave add --db roastery.db
added 2 claim(s), 0 edge(s)

$ cave query --db roastery.db 'coffee/morning-blend HAS defect: ?d'
?d = flat  ; two complaints this week
?d = sour  ; one vague remark

$ cave query --db roastery.db 'coffee/morning-blend HAS defect: ?d' 'WHERE conf >= 0.5'
?d = flat  ; two complaints this week
```

A context in the pattern narrows it the same way a tag does:
`coffee/morning-blend HAS defect: ?d @cafe/north` matches only the second
claim.

Confidence belongs to the *claim*, not to the value. A measurement can be
imprecise while the claim about it is certain, and the other way round;
Chapter 5 keeps the two apart.

== Importance: `!`

A bare `!` marks a claim as important. It is a flag, nothing more, but it is
stored and indexed, and a store with a few hundred claims benefits from
having ten of them flagged:

```cave
roaster/drum HAS service-due: 2026-09-01 !
```

== Comments, once more

The comment after `;` rides with the claim through storage, export, search,
and reports, and so does a block of `;` lines directly above the claim
(Chapter 2). Everything before this chapter used it for the small rationale a
triple cannot carry, and that is the right amount: a comment is where you
write *why*, not where you write the next three claims.

#recap[`@name` scopes a claim and is part of its identity; `@src:`, `@time:`,
`@loc:`, and `@scope:` are the recommended prefixes. `#tag` and `#key:value`
file the claim and carry no history. `@ N%` with a space is confidence,
default 100. `!` flags importance. Use an attribute when a classification
deserves its own history and a tag when it does not.]
