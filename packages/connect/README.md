# @cavelang/connect

Deterministic structured ingestion (spec §23): CSV/TSV rows, JSON/JSONL
objects, SQLite rows and JSON/CSV URLs mapped through a **mapping
template** — an ordinary CAVE document whose `?field` variables stand for
record fields — into claims, with no LLM in the loop. The same input and
mapping always produce the same claims.

```cave
; people.map.cave
WORKS-AT IS verb ; X is employed by organization Y
WORKS-AT REVERSE EMPLOYS

?id IS person
?id HAS name: ?name
?id HAS age: ?age
?id WORKS-AT ?company
```

```sh
cave connect people.csv --map people.map.cave --db k.db --key id
cave connect crm.sqlite --table contacts --map contacts.map.cave --key email
cave connect https://api.example.com/deps.json --records data.items --map deps.map.cave
```

Library API:

```ts
import { Source, Template, connect } from '@cavelang/connect'
import { open } from '@cavelang/store'

const store = open('k.db')
const { mapping } = Template.parse(mappingText)
const { records } = await Source.load('people.csv')
const report = connect(store, mapping!, records, { name: 'people', key: 'id' })
```

## Mapping templates (§23.1)

Variable-free blocks are the **prelude** (verb declarations, static
claims), appended once per run; blocks with variables instantiate once
per record. A claim line whose record lacks a referenced field is dropped
with its indented children — optional columns yield fewer claims.
Substituted values format deterministically: numbers/booleans and safe
atoms verbatim, CAVE values (`20B USD/yr`, `2026-Q1`) verbatim in payload
positions, everything else as an exact quoted literal. Formatting never
invents names — no slugification; shape entity ids in the source.

## Records, digests, provenance (§23.2)

Each record gets identity `connect/<name>/<key>` (`--key <field>`, or the
content digest when unkeyed). Two conventions reuse §9.5 mechanics:

- **Digest claims** — `connect/people/42 HAS connect-digest: 93a01c626b3f
  @src:cave-connect` makes re-runs row-level incremental (`--force`
  overrides); the digest covers the *instantiated* text, so mapping
  changes re-fire records too.
- **Record stamps** — every produced claim is auto-stamped
  `@src:connect/<name>/<key>`, even when the template writes its own
  `@src:` (both are kept — the stamp is the record's lifecycle identity),
  so a changed keyed record diffs against itself: attributes supersede in
  place (the value is outside the claim key, §9.2), vanished relation
  claims are retracted `@ 0%`. `--prune` extends the diff to records that
  left the source.

Records that fail to format are reported, rolled back atomically, and
never poison the rest of the run — or the prune set.

## Continuous and query-time reads (§23.3)

- `--watch` re-runs the pass when the source or mapping file changes;
  digests keep each pass incremental.
- `--query '<pattern>'` is federation-lite: mapped claims append inside a
  transaction, the CAVE-Q pattern runs over the union of store and
  source, and everything rolls back — external data consulted at query
  time, nothing persisted (digest bookkeeping included).
- `--dry-run` prints the instantiated claims and writes nothing.

## Design notes

- **No new syntax.** Templates reuse the CAVE-Q `?x` token form inside
  ordinary CAVE lines; the mapping lints with the standard parser
  (variables parse as plain terms), and instantiated text flows through
  the ordinary parse → canonicalize → append pipeline.
- **Exactness over prettiness.** Values insert verbatim or exactly
  quoted; a value that cannot be quoted (`"` and `` ` `` both present)
  fails that record loudly instead of being mangled silently.
- **Retraction never touches declaration claims** (`X IS verb`,
  `REVERSE`) — verb lifecycle is an open design decision (`TODO.md`), and
  the prelude is additive.
- **Keys are sanitized, claims are not.** The record key rides in an
  entity name and a `@src:` context, so reserved characters collapse to
  `-`; claim subjects/values keep the exact field value.
