#import "../style.typ": note, file, recap

= Documents That Cite Their Claims

A query answers you. A document is for someone else, and it should say
where every fact came from. `cave report` renders a Markdown template
against the store, splicing values into prose and repeating fragments per
match, and footnotes every rendered fact with the claim behind it.

== A template

A template is ordinary Markdown with two live constructs. An inline splice,
`` `cave-q: pattern` ``, drops the single value a sentence needs. A fenced
`cave-q` block holds a pattern, optional `WHERE` lines, and a fragment that
is rendered once per solution with the variables substituted:

#file("brief.md")
````md
# Buying brief

The Huila lot is priced at `cave-q: lot/huila-26 HAS price: ?p` and
scored `cave-q: lot/huila-26 HAS score: ?s`.

## Lots by supplier

```cave-q
?s SUPPLIES ?lot
- **?lot** from ?s [^?]
```

## Specialty grade

```cave-q
?lot HAS score: ?score
WHERE value >= 86
- ?lot scored ?score
```
````

Everything else passes through verbatim: headings, prose, tables,
hand-written footnotes, fenced code in any other language. The template is a
document, not knowledge; it lives in a file under version control, like a
mapping or a hook configuration, never in the store.

== Rendering

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave report --db roastery.db brief.md
# Buying brief

The Huila lot is priced at 7.80 USD/kg[^c1] and
scored 84[^c2].

## Lots by supplier

- **lot/yirgacheffe-26** from kaffa-coop [^c3]
- **lot/huila-26** from la-cima [^c4]
- **lot/santa-ana-26** from la-cima [^c5]

## Specialty grade

- lot/yirgacheffe-26 scored 87 [^c6]

[^c1]: `lot/huila-26 HAS price: 7.80 USD/kg @src:cli` — <date>, claim key `["e:lot/huila-26","HAS",0,"a:price",["src:cli"]]`
[^c2]: `lot/huila-26 HAS score: 84 @src:cupping/june` — <date>, claim key `["e:lot/huila-26","HAS",0,"a:score",["src:cupping/june"]]`
[^c3]: `kaffa-coop SUPPLIES lot/yirgacheffe-26 @src:cli` — <date>, claim key `["e:kaffa-coop","SUPPLIES",0,"r:e:lot/yirgacheffe-26",["src:cli"]]`
[^c4]: `la-cima SUPPLIES lot/huila-26 @src:cli` — <date>, claim key `["e:la-cima","SUPPLIES",0,"r:e:lot/huila-26",["src:cli"]]`
[^c5]: `la-cima SUPPLIES lot/santa-ana-26 @src:cli` — <date>, claim key `["e:la-cima","SUPPLIES",0,"r:e:lot/santa-ana-26",["src:cli"]]`
[^c6]: `lot/yirgacheffe-26 HAS score: 87 @src:cupping/june` — <date>, claim key `["e:lot/yirgacheffe-26","HAS",0,"a:score",["src:cupping/june"]]`
```

Every rendered solution cites its stored row. The marker lands at the
fragment's `[^?]` placeholder when there is one and is appended to the last
line otherwise; inline splices always append. The definitions collect at
the end of the document: the row's canonical line, exactly as `cave export`
prints it with actor stamps included, the date it was recorded, and the
claim key, so a reader can pull the full history behind any sentence. When
a claim carries a source span, the footnote adds the decoded location,
linked when the source is a URL. Labels are `c1, c2, …` in order of first
citation, a namespace hand-written footnotes will not collide with.

A fragment shaped like a bullet renders a list; one shaped like a table row
renders rows under a hand-written header; a paragraph with a trailing blank
line renders prose. A block with no fragment renders each solution as
`cave query` prints it, as a cited bullet. A query with no solutions renders
nothing, which is the honest shape of an empty section.

== Splices are deterministic or nothing

An inline splice must bind exactly one variable and match exactly one
solution. When a second source scores the Huila lot, the sentence cannot be
rendered honestly:

```sh
$ echo 'lot/huila-26 HAS score: 86.5 @src:q-grader/ana @ 80%' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave report --db roastery.db brief.md 2>&1 | sed -n '3,4p;/^template line/p'
The Huila lot is priced at 7.80 USD/kg[^c1] and
scored *(ambiguous: 2 matches)*.
template line 4: ambiguous inline splice "lot/huila-26 HAS score: ?s": 2 matches — several series contest the fact; --resolve picks the §26 winner
[exit 1]

$ cave report --db roastery.db brief.md --resolve | sed -n '3,4p'
The Huila lot is priced at 7.80 USD/kg[^c1] and
scored 84[^c2].
```

The document still renders, with the problem marked in place and reported
on standard error with the template line number, and the command exits 1. A
contested fact is ambiguity working as intended; `--resolve` is the knob,
and the footnote then shows exactly which source the sentence stands on.

== The same report, another day

Every query in a template takes the same read options as `cave query`.
`--as-of` renders the report as belief stood at a past moment; `--at`
anchors it in valid time so one template renders "the plan as of mid-year"
or "next year's projection"; `--aliases` widens names; `--max-sensitivity`
raises the audience ceiling above the default `internal`. The template stays
under version control while the store evolves, and the document is
re-rendered from current belief on demand. Reports are deliberately not an
MCP tool: an agent composing prose already reads through the query tools,
and the report is the human's reproducible deliverable.

#recap[A template is Markdown plus `` `cave-q: pattern` `` splices and
fenced `cave-q` blocks with a per-solution fragment. `cave report` renders
it and footnotes every fact with the canonical claim, date, and claim key.
Splices must be unambiguous; `--resolve` picks a winner. `--as-of`, `--at`,
`--aliases`, and `--max-sensitivity` apply to every query in the document.]
