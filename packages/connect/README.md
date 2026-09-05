# @cavelang/connect

Federated `--query --json` uses the same `cave.query-match/v1` and nested
`cave.claim/v1` representation as `cave query --json`; source database columns
are never serialized.

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
per record. A comment block directly above a block's first line is that
line's comment (spec §6.4) and travels with the block — instantiated once
per record for a template — while a blank line after a comment keeps it
documentary in the prelude. A claim line whose record lacks a referenced
field is dropped with its indented children and the comment block above
it — optional columns yield fewer claims.
Substituted values format deterministically: numbers/booleans and safe
atoms verbatim, CAVE values (`20B USD/yr`, `2026-Q1`) verbatim in payload
positions, everything else as an exact quoted literal. Formatting never
invents names — no slugification; shape entity ids in the source.

## Records, digests, provenance (§23.2)

Each record gets identity `connect/<name>/<key>` (`--key <field>`, or the
content digest when unkeyed). Two conventions reuse §9.5 mechanics:

- **Digest claims** — `connect/people/42 HAS connect-digest: 93a01c626b3f
  @src:cave-connect` makes re-runs row-level incremental (`--force`
  overrides); the digest covers the *instantiated* text and source anchor, so
  mapping changes or a moved record re-fire it.
- **Record stamps** — every produced claim is auto-stamped
  `@src:connect/<name>/<key>`, even when the template writes its own
  `@src:` (both are kept), and explicit `run = connect/<name>/<key>`
  provenance is the record's lifecycle identity,
  so a changed keyed record diffs against itself: attributes supersede in
  place (the value is outside the claim key, §9.2), vanished relation
  claims are retracted `@ 0%`. `--prune` extends the diff to records that
  left the source.
- **Physical source spans** — CLI-connected records also carry the escaped
  file/URL identity. CSV/TSV rows get exact inclusive ranges (including quoted
  multiline records), JSONL rows get their physical line, and JSON/SQLite
  records keep source identity without an invented line. The library accepts
  `source` plus record-aligned `spans` in `ConnectOptions`.

Records that fail to format are reported, rolled back atomically, and
never poison the rest of the run — or the prune set.

## Continuous and query-time reads (§23.3)

- `--watch` re-runs the pass when the source or mapping file changes;
  digests keep each pass incremental. Parent directories are watched before
  the startup pass (so atomic file replacement and startup saves cannot fall
  into a gap), filename-less events conservatively rescan, bursts debounce for
  200 ms, and a failed pass is named on stderr while the next save remains
  retryable.
- Socket and webhook listeners are deliberately external adapters. They own
  transport authentication, retry, delivery, deduplication, and shutdown,
  then write a watched file or invoke one bounded connect pass. The core does
  not become a resident network service with source-specific lifecycle rules.
- `--query '<pattern>'` is federation-lite: mapped claims append inside a
  transaction, the CAVE-Q pattern runs over the union of store and
  source, and everything rolls back — external data consulted at query
  time, nothing persisted (digest bookkeeping included).
- `--dry-run` prints the instantiated claims and writes nothing.

`runConnect` accepts optional `fetchImpl`, `watch`, `schedule`, and
`cancelScheduled` runtime hooks. Production defaults remain built-in fetch,
`node:fs.watch`, and timers; integrations can drive URL, watcher, debounce,
retry, and cleanup boundaries without external network access or sleeps.

## Declared sources (§23.4)

A connect invocation persists in-band as attribute claims on a
`source/<name>` entity — the entity §26.3 already uses for source policy:

```cave
source/people HAS path: data/people.csv
source/people HAS map: data/people.map.cave
source/people HAS key: id
source/people HAS reliability: 80%
source/verbs HAS path: verbs.cave        ; a .cave file is its own template
```

`path` declares the source; `map`, `key`, `format`, `delimiter`, `table`,
`sql`, and `records` mirror the options; a `.cave` path needs no map and is
a lifecycle unit (what it no longer says is retracted when it changes). A
name is one path segment, so it cannot collide with a record key. A followed
`.cave` source may declare or re-declare sources; declarations are re-read
after every source and the current one runs, until nothing changes.
Paths resolve against the store's directory. Declared sources stamp
`@src:<name>/<key>` and keep digests under `source/<name>/<key>`
(`declaredNaming`), so the stamp and the policy entity mirror each other.

```sh
cave connect --db k.db --list            # each declaration as an invocation
cave connect --db k.db                   # one pass over every declared source
cave connect --db k.db --name people --prune
cave connect --db k.db --watch           # every declared file and mapping
cave connect --db k.db --query '?who WORKS-AT acme'
cave query --db k.db '?who WORKS-AT acme' --sources   # the same overlay
cave query --db notes.cave '?who WORKS-AT acme'       # a text store follows its sources on open
```

Programmatic: `Declared.declaredSources(store)`, `Declared.declaredIn(text)`,
`Declared.prepare` / `prepareSync`, `Declared.discover(store, root)` (every
source loaded, nested declarations read from followed `.cave` text, nothing
appended), `Declared.run(store, prepared, { force, prune })`, and
`assemble(store, root)` — the assembler `@cavelang/store`'s `openAt` calls
for a text store, following nested declarations until none is left, never
re-reading the root file, and skipping URL sources (which `cave connect`
follows).

## Design notes

- **No new syntax.** Templates reuse the CAVE-Q `?x` token form inside
  ordinary CAVE lines; the mapping lints with the standard parser
  (variables parse as plain terms), and instantiated text flows through
  the ordinary parse → canonicalize → append pipeline.
- **Exactness over prettiness.** Values insert verbatim or exactly
  quoted; a value that cannot be quoted (`"` and `` ` `` both present)
  fails that record loudly instead of being mangled silently.
- **Retraction never touches vocabulary declarations** (`X IS verb`,
  `REVERSE`, `RENAMED-TO`) — registry history is additive even when the
  connector record that introduced a declaration changes.
- **Keys are sanitized, claims are not.** The record key rides in an
  entity name and a `@src:` context, so reserved characters collapse to
  `-`; claim subjects/values keep the exact field value.
