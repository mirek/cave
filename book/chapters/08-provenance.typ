#import "../style.typ": note, file, recap

= Provenance

A store that only ever grows is only as useful as its answers to "says who?"
This chapter is about how claims are attributed: the stamp every append
surface adds, the four dimensions the store indexes behind the compact
context syntax, line-level citations into sources, audience labels, and the
exact backup that preserves all of it.

== Every append is stamped

Load the roastery and look at the exported text:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave export --db roastery.db | sed -n '/^kaffa-coop IS/,/^la-cima HAS/p'
kaffa-coop IS supplier @src:cli
la-cima IS supplier @src:cli
kaffa-coop HAS country: ethiopia @src:cli
la-cima HAS country: colombia @src:cli
```

None of those lines carried `@src:cli` in the file. The command added it,
because `cave add` is the interactive surface and a claim that names no
source is stamped with the surface that appended it. Each surface has its
own stamp:

#table(columns: (auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Surface*], [*Stamp*],
  [`cave add`], [`@src:cli`],
  [an agent over MCP], [`@src:agent/<client-name>`],
  [`cave ingest` in stdout mode], [`@src:ingest`],
  [`cave connect`], [`@src:connect/<name>/<key>`, one per record],
  [a rule conclusion], [`@src:rule/<digest>`],
  [an action effect], [`@src:action/<name>`],
  [an automation's agent reply], [`@src:automation/<name>`],
)

A claim that already names a source, like the cupping scores with
`@src:cupping/june`, is left alone: authored provenance wins over the stamp.
The exceptions are the *lifecycle* stamps of connect, rules, and actions,
which are added even when the claim names its own source, because the
engine must be able to find its own output later to retract or supersede it.

The stamp is applied *before* the claim key is computed. Since contexts are
part of the key (Chapter 7), the same fact asserted by two actors lives in
two series. That is deliberate: an agent restating a human's claim does not
overwrite it, and a human correcting an agent's claim does not silently
disappear on the next agent run. To write into another actor's series on
purpose, name its context explicitly:

```cave
lot/huila-26 HAS process: washed @src:agent/claude @ 0% ; wrong, it is a natural
```

`cave import` never stamps, because it replays exported text and replayed
claims must keep the keys they were exported with. `cave add --no-src` opts
out for a single run.

== Four dimensions behind one syntax

The context syntax stays compact, but the store does not treat every
`@src:` the same way. Each row also has an indexed *provenance projection*
with four dimensions:

#table(columns: (auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Dimension*], [*Meaning*],
  [actor], [the surface or agent that appended the row],
  [source], [the physical evidence locator, without any line fragment],
  [run], [the engine-owned lifecycle identity a generated row belongs to],
  [domain], [an explicit `@scope:<name>` partition],
)

Connect, derive, act, and automate find their own rows by the *run*
dimension, never by searching for a context string, so an authored `@src:`
that happens to look like an engine stamp cannot escape or spoof engine
ownership. Ordinary queries, claim keys, and exports see only the contexts.
Opening an older store backfills the projection conservatively.

== Citing the exact line

A source context can point at the line or line range that supports a claim.
The fragment is one-based and inclusive:

```cave
lot/huila-26 HAS moisture: 11.4% @src:emails/la-cima-2026-08-12.txt#L14
lot/huila-26 HAS eta: 2026-09-03 @src:emails/la-cima-2026-08-12.txt#L14-L16
```

The whole context is still part of the claim key and travels through export,
import, and sync unchanged. The decoded locator without the fragment is the
source's identity for resolution policy (Chapter 11), so two spans from one
email are one source for trust purposes and two distinct claim series for
history. Reserved characters in the locator are percent-escaped: a space is
`%20`, a literal `#` is `%23`.

`cave ingest` numbers the text it hands to a model and asks for the smallest
supporting range (Chapter 15); `cave connect` records the exact CSV line of
every mapped record (Chapter 14); reports render the location as a footnote
and link it when the source is a URL (Chapter 21).

#note([A span is a pointer, not an archive], [The line range points into the
version of the source that was cited. If the evidence must stay immutable,
keep or version the source itself; the store keeps the pointer, not the
page.])

== Audience labels

Not every claim is for every reader. A sensitivity tag labels a row's
audience, from `public` through `internal` and `confidential` to
`restricted`. Unlabeled rows are `internal`; a malformed label fails closed
as `restricted`.

```sh
$ echo 'la-cima HAS contract-price: 7.10 USD/kg #sensitivity:confidential' | cave add --db roastery.db
added 1 claim(s), 0 edge(s)

$ cave export --db roastery.db | grep contract-price

$ cave export --db roastery.db --max-sensitivity confidential | grep contract-price
la-cima HAS contract-price: 7.10 USD/kg @src:cli #sensitivity:confidential
```

The publication surfaces, `cave export`, `cave serve`, and `cave report`,
default to an `internal` ceiling and must be told explicitly to go higher.
Filtering is structural: counts, search, history, and lineage are computed
from visible rows only, and an edge is emitted only when both endpoints are
visible. For a current-only export, current belief is resolved over the
complete history first and the selected row is then filtered, so a hidden
newer row never revives an older public belief there; the served page and
reports query a store already narrowed to the ceiling. Local queries and
the general MCP tools are not narrowed; when their output will be published,
route it through a scoped surface. Labels are routing metadata, not
encryption or access control.

== What permanence means

Retraction and `--current` change what is believed; they erase nothing. A
row remains in the store, in every export that includes history, in every
peer it was synced to, and in every backup. CAVE deliberately provides no
claim-level delete, because a local delete could not make an honest promise
across SQLite free pages, full-text index shadow tables, transaction
journals, copies, version control, and other machines; and an older peer
could reintroduce the row under its global id anyway.

The consequence is a rule for what to record: nothing that must be
selectively erased later. Credentials, private keys, and personal data with
a retention policy stay out of the store, out of comments, and out of source
citations. If a secret is ingested by accident, rotate it first, stop
writers and sync, inventory every copy, rebuild a store from reviewed safe
input, and then destroy the affected copies with your storage provider's
confirmed procedure. Never merge an affected store back into the clean one.

== Exact backups

Canonical text is portable, but importing it mints fresh transaction ids.
For an exact copy, with every id, transaction, edge, and provenance row,
`cave backup` snapshots the live store:

```sh
$ cave backup --db roastery.db --out roastery.snapshot.db
created exact backup (<n> row(s), schema v1, <n> bytes, sha256:<hex>) at <path>

$ cave backup --verify roastery.snapshot.db
verified exact backup (<n> row(s), schema v1, <n> bytes, sha256:<hex>) at <path>

$ cave restore roastery.snapshot.db --db restored.db
restored exact backup (<n> row(s), schema v1, <n> bytes, sha256:<hex>) at <path>

$ cave query --db restored.db 'la-cima SUPPLIES ?lot'
?lot = lot/huila-26
?lot = lot/santa-ana-26
```

The snapshot is taken online with SQLite's `VACUUM INTO`, so readers and
writers can keep going. It is written to a temporary file, checked for
integrity and schema, hashed, and published atomically; the hash printed is
the token you record and pass to `--sha256` on verify and restore. Restore
refuses a destination with WAL or journal sidecars, because that means
something is still using it: stop every process first. On any failure the
previous destination is untouched.

#recap[Every append surface stamps `@src:` unless the claim names its own
source, and the stamp is part of the key, so actors get separate series.
Behind the syntax the store indexes actor, source, run, and domain.
`@src:file#L10-L12` cites lines. `#sensitivity:<level>` labels audience and
the publication surfaces filter to a ceiling. Nothing is ever deleted; keep
secrets out. `cave backup` and `cave restore` preserve exact identity.]
