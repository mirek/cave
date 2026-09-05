#import "../style.typ": note, file, recap

= Structured Data Without a Model

Inventory lives in a spreadsheet. A CSV row does not need a language model
to become three claims; it needs a template. This chapter introduces `cave
connect`, which maps records from CSV, TSV, JSON, JSON Lines, SQLite, or a
URL through an ordinary CAVE file, deterministically, and keeps the store in
step with the source on every re-run.

== A template is a CAVE file with holes

The roastery's stock count is a CSV with one row per lot:

#file("stock.csv")
```csv
lot,kg,roasted
lot/yirgacheffe-26,42,2026-08-20
lot/huila-26,8,2026-08-18
lot/santa-ana-26,15,2026-08-22
```

The mapping is a CAVE document in which `?field` variables stand for column
names:

#file("stock.map.cave")
```cave
; one row per lot in the green store

?lot HAS stock: ?kg kg
?lot HAS last-roasted: ?roasted
```

A top-level block that contains a variable is a *record template*,
instantiated once per record. A block with no variables is *prelude*: verb
declarations and static claims, appended once per run. A record that lacks
a field, or whose field is empty, simply drops that line and its children;
optional columns yield fewer claims, never malformed ones.

`--dry-run` prints what would be written:

```sh
$ cave connect stock.csv --map stock.map.cave --dry-run --key lot
; --- prelude

; one row per lot in the green store

; --- record 1

lot/yirgacheffe-26 HAS stock: 42 kg
lot/yirgacheffe-26 HAS last-roasted: 2026-08-20

; --- record 2

lot/huila-26 HAS stock: 8 kg
lot/huila-26 HAS last-roasted: 2026-08-18

; --- record 3

lot/santa-ana-26 HAS stock: 15 kg
lot/santa-ana-26 HAS last-roasted: 2026-08-22
```

Values are formatted by position and never invented. Numbers and booleans
render as written; a string that is a safe name inserts verbatim; in payload
position a string that parses as a CAVE value (`8.20 USD/kg`, `2026-Q3`,
`94.5%`) stays a value; anything else becomes a quoted literal. If you need
kebab-case identities, shape them in the source, with a slug column or a
`--sql` projection.

== Records remember themselves

Run it for real, then run it again:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 3 mapped, 0 skipped (unchanged); +6 claim(s)

$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 0 mapped, 3 skipped (unchanged); +0 claim(s)
  note: prelude unchanged, skipped
```

Each record has a stable identity, `connect/<name>/<key>`, where the name
defaults to the file's basename and the key is the `--key` column, or a
content digest when no key is given. After a record's claims append, one
bookkeeping claim records a digest of the *instantiated text*, so a record
is skipped until its data or its mapping changes. Every claim a record
produces is stamped `@src:connect/<name>/<key>`, and for CSV, TSV, and JSON
Lines sources also with the exact line it came from:

```sh
$ cave export --db roastery.db | grep 'stock: 8 kg'
  stock: 8 kg @src:connect/stock/lot-huila-26 @src:stock.csv#L3
```

== When the source changes

The Huila lot was roasted again and the count drops. Overwrite the CSV:

#file("stock.csv")
```csv
lot,kg,roasted
lot/yirgacheffe-26,42,2026-08-20
lot/huila-26,6,2026-08-25
lot/santa-ana-26,15,2026-08-22
```

```sh
$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot
connect: 3 record(s): 1 mapped, 2 skipped (unchanged); +2 claim(s)
  note: prelude unchanged, skipped

$ cave query --db roastery.db 'lot/huila-26 HAS stock: ?kg'
?kg = 6 kg

$ cave query --db roastery.db 'lot/huila-26 HAS stock: ?kg' --all
?kg = 8 kg
?kg = 6 kg
```

Only the changed record was re-mapped, and its attribute claims superseded
naturally because the value is outside the claim key. A relation claim the
record used to produce and no longer does is retracted explicitly, because
the record stamp lets the engine diff a record against its own previous
output. With `--prune`, records that vanished from the source entirely are
retracted the same way. Vocabulary declarations are never retracted;
registry history is additive.

== Continuous and query-time reads

`--watch` keeps the command running and re-maps whenever the file or the
mapping changes; per-record digests keep each pass incremental. It is a
tail loop on one machine, not a platform, and that is the point: a webhook
or socket bridge that owns its own authentication and retry can write a
watched file, and the core never grows a resident listener.

`--query` is federation-lite. The mapped claims are appended inside a
transaction, the pattern runs over the union of store and source, and the
transaction rolls back. Nothing persists, not even digests:

```sh
$ cave connect stock.csv --map stock.map.cave --db roastery.db --key lot --query '?lot HAS stock: ?kg'
?lot = lot/yirgacheffe-26  ?kg = 42 kg
?lot = lot/huila-26  ?kg = 6 kg
?lot = lot/santa-ana-26  ?kg = 15 kg
```

The same command reads a SQLite table (`--table` or `--sql`), a JSON
document (`--records data.items` to point at the array), or a URL that
serves JSON or CSV. Dotted variables like `?address.city` walk nested JSON.

== Declaring a source

Typing the same `cave connect` line every morning is the kind of thing a
store should remember. It can, and with no new syntax: a source is a few
attribute claims on a `source/<name>` entity, the same entity Chapter 11
uses for a source's reliability.

#file("sources.cave")
```cave
source/stock HAS path: stock.csv
source/stock HAS map: stock.map.cave
source/stock HAS key: lot
source/stock HAS reliability: 90%
```

`path` declares the source; `map`, `key`, `format`, `delimiter`, `table`,
`sql`, and `records` mirror the options. A `.cave` path needs no map: the
file is its own template. Paths are relative to the store's directory, so a
store and its sources travel together. Because a CAVE text file is itself
a store (Chapter 9), this file already answers questions: opening it
follows the sources it declares.

```sh
$ cave query --db sources.cave 'lot/huila-26 HAS stock: ?kg'
?kg = 6 kg

$ cave connect --db sources.cave --list
stock: stock.csv --map stock.map.cave --key lot
```

Add the same lines to a SQLite store and `cave connect` with no source
runs every declared source, `--watch` tails all their files, and
`cave query --sources` overlays them without writing. A declared source
stamps `@src:stock/<key>` rather than `@src:connect/stock/<key>`, so the
stamp names the same entity the reliability sits on and the policy applies
to what the source yields.

#recap[`cave connect <source> --map <template>` instantiates a CAVE
document per record; blocks without variables are prelude. Records are
identified by `--key`, digested, stamped `@src:connect/<name>/<key>` and
with their source line, and re-runs re-map only what changed; vanished
claims are retracted, `--prune` handles vanished records. `--watch` tails a
file; `--query` answers over store plus source without writing. A
`source/<name> HAS path:` claim declares a source in-band: `cave connect`
with no argument runs them, and a text store follows them on open.]
