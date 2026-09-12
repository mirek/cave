# @cavelang/connect

Deterministic structured ingestion (spec §23): CSV/TSV rows, JSON/JSONL
objects, SQLite rows and JSON/JSONL/CSV/TSV URLs mapped through a **mapping
template** — an ordinary CAVE document whose `?field` variables stand for
record fields — into claims, with no LLM in the loop. The same input and
mapping always produce the same claims.

| Task | Start here |
| --- | --- |
| Map source fields into claims | [Mapping templates](#mapping-templates-231) |
| Understand digests, keys and provenance | [Records and provenance](#records-digests-provenance-232) |
| Recover a failed refresh without losing history | [Refresh failures and recovery](#refresh-failures-and-recovery) |
| Watch files or query external data | [Continuous and query-time reads](#continuous-and-query-time-reads-233) |
| Read federated JSON results | [Federated query records](#federated-query-records) |
| Cancel a pending source operation | [Cancellation and diagnostics](#cancellation-and-diagnostics) |
| Understand startup, retries and watch cleanup | [Watch lifecycle](#watch-lifecycle) |
| Configure and select persistent sources | [Declared sources](#declared-sources-234) |

HTTP sources infer TSV from `text/tab-separated-values`, including extensionless
endpoints and headers with charset parameters. Explicit `--format` takes
precedence. TSV uses the same column, quoted-field and source-line handling as
local TSV files; `--sql` projection discards line spans as for other formats.
A native HTTP command regression verifies that unterminated quoted fields,
extra cells and duplicate headers preserve imported history under `--prune`.
A corrected TSV response applies additions and retractions, and an unchanged
repeat adds no history.

Local CSV, TSV, JSON and JSONL files, declared CAVE sources, mapping files and
fetched text bodies must be valid UTF-8. Connector file readers share one strict
decoder, including explicit `--map` files and declared mapping paths.
Invalid byte sequences fail with a source-located error before record parsing,
SQL projection or mapping can silently replace their data. A failed declared
source refresh leaves existing claims and digests unchanged, including with
pruning enabled; correcting the bytes allows a normal idempotent refresh.
Explicit replacement characters, accented text and emoji remain supported.
A loopback HTTP integration test exercises the native fetch path after a successful
import: malformed bytes under `--prune` preserve exported history, corrected
responses apply additions and retractions, and repeating the correction adds
no history. This complements the decoder tests for local and mocked HTTP inputs.
A separate native HTTP test closes a response before its declared body length:
the command identifies the source, preserves imported history under `--prune`,
and permits an idempotent retry. Source API errors retain their original identity;
the command loader adds source context when reporting failures.

During `connect`, each referenced field name is resolved once per record and
reused across template slots and `--key` bookkeeping. Programmatic getters
therefore cannot give the same field different claim and record identities.
Values are captured lazily for that record; later runs read them afresh.

Field lookup checks an exact own key first, then follows a dotted path through
own properties (including array indices). Inherited JavaScript properties are
missing fields. Explicit JSON keys such as `constructor` and `__proto__` remain
ordinary data, and missing optional fields drop their template lines normally.
JSON `--records` selectors use the same lookup rules for local and HTTP sources,
including exact dotted keys taking precedence over nested paths. The selected
value must be an array of objects. An empty array is valid; null, scalar or
array-valued entries reject the load with a one-based record number. A valid
prefix is not returned as a partial result when a later entry is invalid.
Correcting the source permits a fresh load through the same local or HTTP API.
For `cave connect --prune`, an invalid selected record prevents the refresh
from updating an earlier valid record or retracting records absent from that
malformed input. After correction, normal updates and pruning resume; an
unchanged repeat remains idempotent.

JSON and JSONL numeric tokens are parsed as JavaScript numbers. Integers outside
the safe range and high-precision decimals can lose digits before mapping or
SQL projection; for example, numeric IDs `9007199254740992` and
`9007199254740993` become the same number. Encode identifiers and decimals that
require exact digits as JSON strings, such as `"9007199254740993"` and
`"0.1234567890123456789"`. Those strings retain their digits through local and
HTTP loading and plain SQL projection. Casting them to a SQL numeric type can
lose precision again. SQLite's large-integer preservation described below does
not recover digits already lost while parsing JSON.

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
import { Source, Template, connect } from '@cavelang/cli/connect'
import { open } from '@cavelang/store'

const store = open('k.db')
const { mapping } = Template.parse(mappingText)
const { records } = await Source.load('people.csv')
const report = connect(store, mapping!, records, { name: 'people', key: 'id' })
```

Direct `connect` calls require a dense array of record objects. Missing array
entries, nulls, primitives and nested arrays are rejected before prelude writes,
record updates or pruning. A gap in a caller-created array is not evidence that
a source record disappeared. Correct the batch and rerun to resume ordinary
incremental updates and pruning. The connector captures the array entries once
before provenance processing; individual fields retain their existing lazy,
once-per-record capture for templates and keyed bookkeeping.
`Source.queryRecords` applies the same batch contract before SQL staging. Column
discovery and insertion use the captured entries, so changing an array-index
getter cannot replace a row between those phases and make it disappear from a
filtered projection. The array length is captured once and must be a number that
is an integer from 0 through 4,294,967,295; invalid proxy lengths are rejected
before either operation can treat the batch as empty. Empty batches and
field-less object records remain valid. This captures the advertised array
entries, not a deep snapshot of record fields.

## Mapping templates (§23.1)

Explicit `@claim` lines use the same subject formatting as ordinary claims.
For example, `@claim ?id IS record` quotes an `id` field of `20 kg` as an
entity, while `@claim sensor HAS amount: ?amount` keeps an `amount` field of
`20 kg` numeric. The marker does not occupy the subject slot.
Qualifier entities and comparison left sides follow subject formatting too,
including after `NOT` or `@claim`: `WHEN ?id > ?amount` quotes an `id` of
`20 kg` while retaining an `amount` of `30 kg` as a numeric comparison value.

Variable-free blocks are the **prelude** (verb declarations, static
claims), appended once per run; blocks with variables instantiate once
per record. A comment block directly above a block's first line is that
line's comment (spec §6.4) and travels with the block — instantiated once
per record for a template — while a blank line after a comment keeps it
documentary in the prelude. A claim line whose record lacks a referenced
field is dropped with its indented children and the comment block above
it — optional columns yield fewer claims.
Comment attachment preserves source order and takes linear work in the size of
the comment block, including long generated provenance notes.
Prelude and template expansion append those lines iteratively, so large
comment runs do not exceed JavaScript's function-argument limit. Regression
coverage includes 130,000 attached, omitted, prelude and trailing comment lines.
Mappings and expanded output still reside in memory.
Substituted values format deterministically: numbers/booleans and safe
atoms verbatim, CAVE values (`20B USD/yr`, `2026-Q1`) verbatim in payload
positions, everything else as an exact quoted literal. Formatting never
invents names — no slugification; shape entity ids in the source.

A short mapping can be written inline wherever a mapping is named, as a
comma-separated list of claim lines (the §25.1 effect-template convention):

```sh
cave connect people.csv --map '?name IS person, ?name WORKS-AT ?company' --key id
```

`--sql` reshapes any tabular source before the mapping: for csv, tsv, json,
and jsonl the records load into a temporary in-memory SQLite table
(`records`, or `--table`), the source's columns first and values exactly as
parsed — CSV cells are text, so cast for arithmetic — structured values as
JSON text, and the query's rows are the records — projection, filtering,
and derived columns in SQL, no expression language of its own
(`Source.queryRecords`).
The optional `Source.queryRecords` schema must be a dense array of string column
names. Its length and entries are captured once before staging, so a changing
caller header cannot disable missing-column validation. Omitted and empty schemas
still allow empty-source column inference; repeated names remain one column.
Staging reads each record's own fields; a column absent from a record becomes
SQL NULL, including names such as `toString`, `constructor` and `__proto__`.
Non-finite numeric inputs are rejected before staging, including inside structured
fields, so NaN cannot become NULL and infinities cannot pass through silently.

SQLite integer results remain numbers inside JavaScript's safe integer range;
larger positive and negative integers become exact decimal text for mapping.
This applies both to direct SQLite sources (`--table` or `--sql`) and SQL over
staged text-format records. Floating-point values remain numbers.
SQL result column names must be unique (case-sensitive), including when a query
returns no rows. Repeated names from projections or joins would overwrite values
in record objects, so loading rejects them and asks for distinct `AS` aliases.
This applies to both direct SQLite reads and staged text records. A collision
caused by changed source columns fails before mapping or pruning; existing
claims and digests remain intact.
Source SQL must declare result columns before it executes. Statements such as
`VACUUM INTO`, `DELETE` and plain `UPDATE` are rejected instead of being treated
as an empty source; in particular, `VACUUM INTO` cannot create an output database
through source loading. A `SELECT` with columns and zero matching rows remains
a valid empty source. This check applies to both direct SQLite reads and SQL
over staged text records.
Both source connections and temporary SQL-staging connections attempt close
once. If a query/staging operation and close both fail, an `AggregateError`
retains the operation error as cause and first entry and the close error second.
A close-only failure propagates directly. Simultaneous query and close failures
stop empty-source column inference rather than opening another staging
connection. A later independent load can retry normally.

Empty-source SQL column inference retries only when an error provides a readable
string identifying a missing column. An unreadable or non-string message keeps
the original SQL exception and does not trigger another staging attempt. The
failed attempt still closes its owned database before the error is inspected.

CSV and TSV reject an unterminated quoted field with its opening physical line
number. Stray quotes in unquoted fields and text after a closing quote are also
rejected with their physical line. Source loading fails before mapping and
pruning, so malformed quoting cannot alter values or cause existing records to
be retracted by `--prune`.
Headers are trimmed and must then be unique (case-sensitive). Duplicate names
are source errors, even without data rows or when using `--sql`; no column is
silently overwritten by a later one.
Rows with more cells than header columns are rejected at the row's starting
physical line. Shorter rows retain the existing empty-string defaults for
missing cells; delimiters inside quoted values are ordinary field content.
These checks also apply to declared sources. A rejected refresh preserves their
existing claims, record digests and declaration metadata; restoring the same
valid source remains an unchanged-input skip.
Blank lines are ignored, but an explicitly quoted empty field (`""`) is a
record, including at end-of-file without a newline. It retains its physical
line span and participates in SQL projections and counts.
The shared reader validates custom delimiters even for empty sources: exactly
one character, excluding double quotes, CR and LF. Semicolons, pipes and tabs
are supported. Invalid delimiter options fail before mapping or pruning.
Delimiters must be primitive strings; `null`, arrays and boxed strings are
rejected without coercion. Only omission selects the CSV or TSV default.

Explicit source formats must be `csv`, `tsv`, `json`, `jsonl` or `sqlite`.
Programmatic loaders reject other values, including `null`, before reading files
or fetching URLs. Omit the format to retain automatic detection.

HTTP source failures report the URL and status code and cancel the unread
response body. A body-cleanup failure does not replace the HTTP error.
URL sources reject unpaired Unicode surrogates before requesting a resource.
Fetch deadlines accept decimal seconds resolving to whole milliseconds in
0..2147483647, including `1.001` as 1001 ms; zero requests an immediate timeout.
Only omission selects the default deadline. Explicit `null` and nonnumeric values
are rejected before fetching, without invoking numeric conversion methods.
The deadline covers response-body consumption as well as waiting for headers.
A stalled partial body fails without returning partial records; a subsequent
load makes a fresh request and can succeed. Invalid deadlines reject before
fetching. Source loading captures its parsing,
SQL, transport and cancellation settings before work; changing caller options
during a fetch cannot alter parsing or remove cancellation. Direct `fetchText`
calls also retain their original signal through response-body reads.
HTTP format detection recognizes NDJSON and JSONL media types before generic
JSON, ignoring media-type casing and parameters. Explicit `--format` takes
precedence. JSONL responses retain physical record line spans unless SQL
projection changes the record alignment.
JSON syntax errors identify the source path or URL, retain the parser diagnostic,
and remain `SyntaxError` instances with the original error as `cause`. Correcting
the file or HTTP response permits a fresh load.
Declared JSON refreshes parse the complete document before record updates or
pruning. A truncated array preserves existing claims, digests and ownership even
when its prefix contains a complete changed record. Assembly reports the declared
source name alongside the file diagnostic. Restoring the prior document is an
unchanged-input skip, with no new history or retirements.
JSONL syntax errors identify the source path or URL and the physical line,
counting blank lines, and preserve the underlying JSON parser error as the cause.
JSONL refreshes also validate every non-blank line before mapping: a later
truncated object, null, scalar or array prevents earlier records from updating
claims and prevents pruning. Correcting the file resumes normal updates and
pruning; repeating the corrected input remains idempotent.

## Records, digests, provenance (§23.2)

Explicit record keys must be strings, finite numbers, booleans, or programmatic
bigints that remain non-empty after sanitization. Objects, arrays, functions,
symbols and non-finite numbers are unusable keys: their records fail and pruning
is skipped because the missing identity cannot establish which records vanished.
An unusable source name rejects the whole pass before its prelude, records or
pruning can write. Programmatic invalid names retain that diagnostic even when
JSON serialization fails; the displayed value becomes `[unprintable value]`.
Correcting the name permits a normal refresh.

Each record gets identity `connect/<name>/<key>` (`--key <field>`, or the
content digest when unkeyed). These mechanisms reuse §9.5 provenance:

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
  left the source. Separate source names retain distinct lifecycle identities
  even when their record keys and extracted facts match, or their templates
  supply the same authored `@src:` context. Revising or pruning one source
  preserves the other source's copy and independently authored claim series.
  A pruned record that returns is imported again because its completion digest
  was retracted; the next unchanged refresh can skip it normally.
- **Physical source spans** — CLI-connected records also carry the escaped
  file/URL identity. CSV/TSV rows get exact inclusive ranges (including quoted
  multiline records), JSONL rows get their physical line, and JSON/SQLite
  records keep source identity without an invented line. The library accepts
  `source` plus record-aligned `spans` in `ConnectOptions`. The source and
  each record's span are validated and converted to contexts before prelude,
  record or pruning writes. Invalid provenance therefore rejects the pass
  without partial updates; correcting it permits a normal idempotent refresh.
  An invalid source also rejects an empty refresh before it can prune.

Duplicate keys are processed in source order: the last successful record wins.
A later failed duplicate leaves that successful version intact and still counts
as present for pruning. Other keys genuinely absent from the source can still
be pruned when all failed records have reliable identities.
The programmatic `connect` entrypoint requires booleans for supplied `force`,
`prune` and `preludeLifecycle` settings. Omission means false. Strings, null and
other values throw before any unit is published, preserving the store for a
corrected retry.

Each `connect` invocation captures its top-level options before mapping or
writing. Changing option getters or replacing caller fields cannot switch
pruning, keys or source configuration midway through that pass. Referenced
naming objects retain their readonly caller contract; record source contexts
are captured before writes.
Record and prelude writes recheck their digest after reserving the write
transaction. If another connection already completed the same refresh, the
pending write is skipped; `--force` still bypasses digest skipping.
The exported `currentRowsUnder(store, prefix)` helper uses indexed Unicode
prefix ranges and returns current rows in transaction order. An empty prefix
selects all current rows; prefixes ending at the maximum Unicode code point
remain valid. Unpaired UTF-16 surrogates reject before SQLite binding.
### Refresh failures and recovery

Record-failure text appends individual diagnostics iteratively, so large lists
do not exceed JavaScript's function-argument limit. Regression coverage checks
all 130,000 errors for one rejected record and verifies that its claims were
not added. Reports still assemble in memory.

A normal refresh commits its prelude and each successful record in separate
transactions. Disappearance pruning has one transaction for all retirements.
The point of failure determines what remains committed:

- **Source loading, name or provenance validation:** no prelude, record updates
  or pruning from this pass. Correct the input and retry.
- **Prelude ingestion:** the failed prelude rolls back; records and pruning
  have not run. Correct the mapping or write failure and retry.
- **Record validation with a usable key:** a formatting or ingestion problem
  preserves the record's previous claims. Other valid records can commit, and other absent keys can
  be pruned. Correct the record; unchanged successful records are skipped on retry.
- **Missing or unusable key, or an unkeyed record fails:** valid records can
  commit, but pruning is skipped and the report explains the missing identity.
  Repair the key or source and rerun with `--prune`.
- **Unexpected record write exception:** the current record rolls back and the
  pass stops before later records or pruning. Earlier committed units remain.
  A digest write failure rolls back that record's claims and digest together.
  Resolve the write failure and retry; unchanged committed records are skipped.
- **Pruning write failure:** all retirements from this pruning phase roll back;
  earlier successful record updates remain committed. Retry the same refresh
  to skip committed records and run pruning again.

Report counts for added and retracted claims exclude rolled-back record writes.
Once recovery succeeds, an unchanged repeat adds no further history. An empty,
valid source still prunes normally.

Changing a previously connected **declaration** uses a wider transaction:
replacement records, retirement and digest bookkeeping roll back together if
any replacement record fails. The last successful declaration remains available
for a corrected retry. See [Declared sources](#declared-sources-234).

## Continuous and query-time reads (§23.3)

- `--watch` re-runs the pass when the source or mapping file changes;
  digests keep each pass incremental. Parent directories are watched before
  the startup pass (so atomic file replacement and startup saves cannot fall
  into a gap), filename-less events conservatively rescan, bursts debounce for
  200 ms, and a failed pass is named on stderr while the next save remains
  retryable.
- Declared watches refresh their source and mapping subscriptions after each
  pass. Moving or removing a declaration closes targets no longer needed by the
  selected sources, while shared targets remain watched. Late callbacks from
  retired subscriptions do not schedule more work. If a newly discovered target
  cannot be watched, stderr names the subscription failure and existing watchers
  remain available; the next save retries registration. This also applies to
  sources discovered by the initial pass. Failure to register the initial set
  before any pass starts still ends the command and closes its handles.
  Selection follows declaration ownership transitively, including ownership
  through source records. An indexed queue visits each selected owner once;
  duplicate selections, cycles, and shared descendants do not duplicate work
  or results. Queue traversal does not repeatedly shift the remaining entries.
- Socket and webhook listeners are deliberately external adapters. They own
  transport authentication, retry, delivery, deduplication, and shutdown,
  then write a watched file or invoke one bounded connect pass. The core does
  not become a resident network service with source-specific lifecycle rules.
- `--query '<pattern>'` is federation-lite: mapped claims append inside a
  transaction, the CAVE-Q pattern runs over the union of store and
  source, and everything rolls back — external data consulted at query
  time, nothing persisted (digest bookkeeping included).
- `--dry-run` prints the instantiated claims and writes nothing.

### Federated query records

Federated `--query --json` uses the same `cave.query-match/v1` and nested
`cave.claim/v1` representation as `cave query --json`; source database columns
are never serialized. Direct and declared-source federation capture these records,
including source contexts and run provenance, before rolling back the temporary
claims. JSON is printed after rollback. Partial mapping failures still return
valid partial records with a nonzero exit status.
If record projection fails, the command rolls back temporary claims, emits no
JSON, and exits nonzero. Repairing the underlying stored record allows a later
query to run normally.

Declared queries load sources on a private snapshot, then compare declaration
state again inside the query transaction. If another writer changed that state,
the query discards the prepared sequence and discovers it again. After three
attempts interrupted by declaration changes, it exits nonzero without printing
query results; retry when the store is quiet. Successful and failed queries
preserve the other writer's history. This check covers stored declarations,
not changes to remote content that leave those declarations unchanged.

### Cancellation and diagnostics

An already-aborted signal passed to `runConnect` returns quietly with code 0
before argument handling, source reads, or database access. This also covers
list, preview, and pruning modes when calling the package entry directly.

For direct `cave connect <source> --map ...` loads, the caller's cancellation
signal is combined with the URL timeout and checked before and after loading.
Cancellation interrupts native response-body reads and prevents returned records
from being mapped or committed, even if an injected transport returns data after
abort. A plain cancellation preserves the caller's reason. If a transport error
already contains that reason in its cause or aggregate errors, the wrapper is
preserved so its additional diagnostics survive. An independent fetch/body error
occurring with cancellation produces an `AggregateError` containing the reason
first and the transport error second, with the reason as `cause`.
An unreadable error message or failing string conversion produces the diagnostic
`[unprintable thrown value]` without replacing either original value. Nested/cyclic
error graphs are inspected without recursive traversal.
Cancellation traversal reads each cause once. If a cause or aggregate-member
accessor throws, the original error remains intact and cancellation is retained
separately unless another readable branch already contains its reason. The command loader uses
the same rule, so both diagnostics reach `cave connect` stderr. A cancelled
load does not change previously imported history.

Declared JSON and `.cave` URL preparation follows the same cancellation signal.
Discovery also preserves wrapped and independent transport failures through its
private snapshot cleanup. Combined discovery and declaration-scratch failures
use safe diagnostic formatting, retain original errors in occurrence order and
keep the first failure as cause. An unreadable close diagnostic cannot skip
later cleanup attempts or replace the earlier failure. A failed fetch removes the private snapshot and leaves
the original store's annotated history unchanged. Retrying with a fresh request
can discover the source successfully; that successful discovery snapshot is also
released without applying records to the original store.
Ordinary declared passes stop before applying the interrupted source and before
following further declarations; sources committed earlier in that pass remain
committed. Dry runs and query discovery discard their private snapshot and emit
no cancelled result. Both direct and declared watch shutdown stop queued work,
ignore subsequent file callbacks, close subscriptions, and wait for the active
pass before the store closes. Direct and declared watch registration share their
cleanup scope: failure to register a later watcher attempts to close every watcher already
created, before any initial pass can write. `--force` and `--prune` do not override cancellation.
The library accepts `signal` in `Source.Options` and `Declared.DiscoverOptions`,
and as the optional fourth argument to `Declared.prepare`. Pre-aborted discovery
fails before allocating its snapshot.
`runConnect` captures its context signal before startup and returns quietly
when it is already aborted, without creating a database. I/O, fetch and watcher
callbacks are captured for the invocation as well.
Discovery captures its signal, source selection, fetch callback and refresh
settings before allocating that snapshot. Changing caller options during URL
work cannot replace the signal or alter the remaining discovery pass.
`Declared.prepare` and `prepareSync` copy the declaration's fields before
loading. Their prepared result retains the name, path and mapping configuration
that selected its content, even if the caller later changes the original object.

The text-only declaration readers (`declarationsIn` and `declaredIn`) close their
owned in-memory scratch store once. If reading and closing both fail, they retain
both errors in an `AggregateError`, with the read error first and as `cause`, and
include both messages. A lone read or close failure is rethrown unchanged.

Discovery always attempts to close its private snapshot and remove its temporary
directory, even if reading a source or closing the snapshot fails. Failed snapshot
creation also attempts directory removal. A lone failure retains its original
identity; simultaneous failures produce an `AggregateError` ordered as operation,
store close, then directory removal, with the first failure as `cause` and all
messages included. Removal failure can leave the private directory behind; these
cleanup attempts do not guarantee resource release. Discovery leaves the caller's
store open and does not append its replayed source claims there.

Command-owned stores stay open until their asynchronous work settles and receive
one close attempt. If command work and final store close both fail, their errors
are retained in order with the command error as cause; stderr names both failures
and the exit status is non-zero. Command and watch diagnostics use
`[unprintable thrown value]` when reading a message or converting an exception
to text would throw, so formatting cannot replace the original combined errors.
This covers direct passes and queries, declared
listing/dry-run/query/pass operations, and both watch modes. A close-only failure
also fails the command. This error contract does not roll back a pass that already
committed successfully before output or cleanup failed.

### Watch lifecycle

When declarations remove a watched source or mapping, refresh detaches each
obsolete subscription and disables its callbacks before attempting its close.
One failed close does not skip the remaining obsolete subscriptions or prevent a
fresh subscription if the path is declared again. Retirement failures are reported
through the watch-subscription diagnostic; multiple failures retain their order
and messages. The session continues with its current subscriptions, and shutdown
closes those subscriptions without retrying already retired handles. As with
shutdown, attempting close does not guarantee that the underlying resource was
released.

The initial watch pass uses the same serialization boundary as later refreshes.
Saves received while startup is loading a source coalesce into a subsequent
pass, including when the initial load fails. They cannot start a second fetch
while the first is pending or publish an older startup response after a newer
refresh. The ready message follows the queued startup work. Abort discards
queued startup work and prevents a late response from publishing. A transport
that ignores its cancellation signal must still settle before command cleanup
finishes; watch cancellation does not impose a hard transport deadline.

A filesystem watcher error, fatal watch diagnostic, debounce-scheduling or
timer-cancellation error ends the watch without waiting for an external abort.
Both direct and declared watches handle subscription error events through the
command, close all owned subscriptions and return a non-zero status. Errors
from already retired or stopped subscriptions are contained without restarting
work; a fresh invocation can establish new subscriptions. Scheduled callbacks retain
asynchronous failures within the command, disable further passes, and initiate
normal shutdown; they do not leave an unhandled rejected timer callback.
Ordinary pass failures still report and allow a later save to retry. Abort
listeners are removed when the session ends, including fatal-error exits.

Watch shutdown disables callbacks first, then attempts timer cancellation and
every watcher close, and waits for an active pass even if cleanup fails. A stale
scheduled callback cannot start another pass after shutdown. Multiple failures
retain their order: session/registration failure, timer cancellation, watcher
closes, then any active-pass failure. The command reports their messages and
returns a non-zero status; a single failure retains its original error internally.
A failed close is an attempted cleanup, not proof that the underlying resource
was released.
A fatal subscription error stops future refreshes but does not itself abort a
refresh already running. That refresh may commit before shutdown returns a
non-zero status, even if subscription close also fails. Explicit signal
cancellation has the separate late-publication guard described above; inspect
source history before retrying after a fatal watch error. A completed refresh's
digest makes an unchanged fresh run idempotent.

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
`sql`, and `records` mirror the options — `map` may be inline, `sql` applies
to any tabular source; a `.cave` path needs no map and is a lifecycle unit
(what it no longer says is retracted when it changes). A
name is one path segment, so it cannot collide with a record key. A followed
`.cave` source may declare or re-declare sources; declarations are re-read
after every source and the current one runs, until nothing changes.
Each declaration attribute uses its newest current positive claim across source
series. Retraction (`@ 0%`) affects only the matching series: if a root file
declares `root.cave` and a later followed source declares `followed.cave` for
the same path attribute, retracting the followed source's claim exposes
`root.cave` again. To remove the source, retract every surviving positive path
series, retaining each claim's contexts and actor stamp. The source disappears
from declaration discovery when no positive path remains; this alone does not
retire data previously imported from it.
A missing or malformed `.cave` file fails preparation for that source; it is
not treated as an empty revision. Its previous imported data and successful
digest remain available. Restoring identical file contents reuses that digest
without adding duplicate history; a later valid edit follows the ordinary
source diff. Removing and then restoring the same declaration likewise retains
its successful digest and imported data. These are per-source guarantees, not
a promise that a multi-source pass rolls back earlier successful sources.
The writing command reports successful sources on stdout and source failures on
stderr, continues to later sources, and exits nonzero if any source failed.
Earlier and later successful sources stay committed; a corrected retry skips
unchanged successes. A thrown preparation or application failure during `--dry-run` or
federated `--query` aborts discovery before returning a preview or query result
and leaves the original store unchanged.
Changing a previously connected declaration replaces its data in one
transaction. If any replacement record fails, the entire replacement rolls
back, including retirement and digest bookkeeping, and the command reports an
error. The last successful declaration remains recorded so a corrected retry
performs the full transition again. Ordinary passes under an unchanged
declaration keep their per-record failure isolation.
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

Declared-source options use the same boolean contract: `Declared.run` validates
`force` and `prune` before its transaction; discovery validates `force`, `prune`
and `skipFollowed` before creating its snapshot or loading sources; `assemble`
validates and captures `force` before following declarations. Omission means
false, and malformed values leave origin history unchanged for a corrected retry.
Discovery still checks an already-aborted signal before other configuration.

Declared-source discovery and synchronous assembly report source validation,
preparation and thrown application failures as
`LocateError` with the source name and path, retaining the original failure as
`cause`. This includes a syntactically valid source whose prelude conflicts
with the vocabulary while being applied to the discovery snapshot.
Unprintable diagnostics use `[unprintable thrown value]`. Discovery
preserves cancellation errors without wrapping them, including combined
transport failures, and still disposes its private snapshot. If cleanup also
fails, the located source error is the first aggregate entry and retains
the original operation as its cause. This error
classification does not roll back sources that completed earlier in assembly;
a failure before preparing the first source leaves existing history intact.

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
