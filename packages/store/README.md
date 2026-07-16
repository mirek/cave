# @cavelang/store

CAVE persistence on the **Node.js builtin `node:sqlite`** — no native
dependencies. Implements the spec §13 storage model: the exact §13.1/§13.2
schema (`cave_claim`, `cave_context`, `cave_tag`, `cave_edge`, `cave_fts`
FTS5), append-only belief series, and inverse-aware reads.

```ts
import { open } from '@cavelang/store'

const store = open('knowledge.db')          // or open() for in-memory
store.ingest(`
packages/api PART-OF monorepo @ 50%
monorepo CONTAINS packages/api @ 90%
`)
store.currentBeliefs()                       // one row — one fact, one key, conf 0.9
store.reverse('packages/api')                // [{ verb: 'CONTAINS', rel: 'PART-OF', source: 'monorepo' }]
store.exportText({ current: true })          // canonical text through internal
store.exportText({ maxSensitivity: 'restricted' }) // exact retained history
```

## Semantics

- **Append-only** (§9.1): `ingest` only inserts; every row carries a
  monotonic UUIDv7 in `id` and `tx`, so `MAX(tx)` per `claim_key` is the
  current belief. Each ingest call is one SQLite transaction. Outer writes
  reserve SQLite's write lock and re-observe `MAX(tx)` before minting, so
  concurrent processes allocate in commit order; lock contention waits for
  up to five seconds before surfacing `SQLITE_BUSY`.
- **History is permanent** (§9.6): retraction appends a `0%` row; it never
  erases the earlier row, `raw_line`, metadata, FTS text, export, backup, or
  peer copy. The store has no row-level redact/forget API because local
  deletion cannot guarantee erasure across SQLite remnants and distributed
  copies. Keep secrets and selectively erasable data out of CAVE; recover
  from accidental ingestion by quarantining every copy and rebuilding from
  reviewed safe input.
- **Publication is sensitivity-scoped** (§9.7):
  `#sensitivity:public|internal|confidential|restricted` labels each immutable
  row; unlabeled means `internal`, while flat, malformed and unknown labels
  fail closed as `restricted`. Export defaults to a maximum of `internal`.
  Select `restricted` explicitly for an exact backup. This is routing metadata,
  not encryption, access control, erasure or a retention boundary.
- **One row per fact** (§13.3): inverse writes are canonicalized before
  keying (`@cavelang/canonical`), inverse *reads* are query-time views —
  `forward()` uses the subject index, `reverse()` the object index with the
  relation named via the registry's `inverseOf`. Nothing is materialized.
- **Registry persistence is in-band**: `REVERSE`, `RENAMED-TO`, and `X IS verb` claims are
  ordinary rows; on open the store replays them (in tx order) on top of the
  initial registry, which defaults to the standard §5.5 prelude pairs. The
  replay predicate mirrors the canonicalizer exactly — qualifier-condition
  rows never declare, and `X IS verb` needs a verb-shaped subject — so the
  registry after reopen equals the registry at close.
- **Verb renames preserve history** (§5.8): after `OLD RENAMED-TO NEW`,
  either spelling writes the stable `OLD` storage verb and therefore the same
  claim key. `NEW` is preferred for authors while `OLD` remains compatible;
  declaration replay on reopen and `registryAsOf` preserve the same
  transaction-time boundary semantics as inverse declarations.
- **Traversal defaults**: `forward`/`reverse`/`topicMembers`/`topicsOf`
  read *current beliefs* and skip negated (`VERB NOT`) and retracted
  (`@ 0%`) rows; opt back in with `{ negated: true, retracted: true }`.
  Contradictions still coexist as rows (§9.4) — resolution belongs to the
  query layer.
- **Alias closure is opt-in** (§13.6): `{ aliases: true }` on traversal
  (and on `claimsAbout`) matches the entity through every name linked by
  current positive `ALIAS` claims, read as undirected edges;
  `aliasesOf(entity)` returns the closure itself. Union-of-rows semantics:
  matching widens, stored names come back untouched, and disagreeing
  belief series surface side by side rather than merging silently. Unmerge
  is retraction — `dupe ALIAS canonical @ 0%`.
- **Actor provenance is caller-supplied** (§9.5): `ingest`/`insertResult`
  accept `{ source }` and stamp `@src:<source>` on every appended claim
  that carries no `src:` context — *before* the claim key is computed, so
  the stamp is part of claim identity and the same fact asserted by
  different actors keeps separate belief series (§9.4). A written `@src:`
  always wins; `raw_line` stays as authored. Interchange replay (`cave
  import`) passes no source, preserving exported keys.
- **Source spans retain source identity** (§9.8):
  `@src:docs/design%20notes.md#L10-L20` carries a one-based inclusive range;
  `SourceSpan` owns escaping and parsing. The exact context remains in the
  claim key, while resolution/reliability strip the line fragment before
  policy matching. `AppendOptions.contexts` lets connectors attach structured
  spans before keying without rewriting generated CAVE text.
- **Contradiction resolution is opt-in** (§26): `{ resolve: true }` on
  traversal reads only the winners — coexisting series about one fact
  (claim key modulo `src:` contexts and polarity) collapse to the row the
  policy picks: precedence class (max over the row's sources), then
  reliability-weighted confidence (min over sources), then tx. The policy
  merges a built-in ladder (`cli` 4 > `agent`/`action` 3 > root 2 >
  `rule` 1) with in-band `source/<name> HAS precedence:` /
  `HAS reliability:` claims, matched to `src:` contexts by longest
  segment prefix; the declarations themselves resolve under the built-ins
  alone, so ingested text cannot self-elevate. Winners come back
  verbatim — resolution filters, it never rewrites — and it composes with
  `aliases`, which widens groups through the closure (the §13.6
  pick-a-winner story).

## API

| Method | Spec | Purpose |
|---|---|---|
| `ingest(text, {strict, source})` | §13.4 | parse → canonicalize → append; lenient by default |
| `insertResult(result, {source})` | | append a pre-canonicalized `@cavelang/canonical` result |
| `currentBeliefs({minConf})` | §13.5 | latest row per key |
| `currentBelief(key)` / `history(key)` | §9.1 | one fact's belief series |
| `resolvedBeliefs({aliases})` | §26 | one winner per resolution group |
| `contested({aliases})` | §26.4 | contested groups, candidates ranked winner-first — the fusion feed |
| `resolutionPolicy()` | §26.3 | effective policy: built-ins merged with in-band declarations |
| `claimsAbout(entity, {aliases})` | §13.5 | both directions, all rows |
| `forward(entity)` / `reverse(entity)` | §13.3 | named traversal, inverse-aware |
| `aliasesOf(entity)` | §13.6 | the entity's alias closure |
| `byTag(key, value?)` | §13.5 | flat (`value` omitted → `IS NULL`) or scoped |
| `byContext(ctx)` | §13.5 | context filter |
| `topicMembers(t)` / `topicsOf(e)` | §11.2 | topic layer over `CONTAINS` |
| `search(q, {raw, limit, maxSensitivity})` | §13.2 | FTS5; literal phrase by default, `limit` caps in the query; sensitivity is opt-in for enclosing publication surfaces |
| `edgesOf(id)` | §13.2 | qualifier/grouping edges with roles |
| `toClaim(row)` | | reconstruct the canonical claim + side tables |
| `registry()` / `baseRegistry()` | §5.5 | current registry and its configured pre-declaration base |
| `exportText({current, tx, maxSensitivity})` | §9.7 | emit sensitivity-scoped canonical CAVE text (default maximum `internal`); `tx` includes replayable `;@` row identities; `current` compacts, never sanitizes; exact backup requires `restricted` |
| `db` | | raw `DatabaseSync` — used by `@cavelang/query` |

## Storage decisions

- **Terms are stored formatted**: entities as plain text (so the spec's
  `WHERE subject = 'auth/middleware'` queries work verbatim), literals with
  their delimiters (`` `<=` ``, `"…"`) so they never collide with
  same-spelled entities and reconstruct losslessly.
- **`value_text` is the value as written** (including `~`, multiplier
  letters and literal delimiters); `value_num`/`value_unit` hold the
  normalized §13.4 forms. Same for `delta_*`.
- **`id` doubles as `tx`** by default: a UUIDv7 is both unique and
  time-ordered, and per-row tx ids keep same-document belief updates
  ordered by line. Allocation is database-serialized across processes;
  nested store transactions remain savepoints.
- **`search()` phrase-quotes by default** — FTS5 would parse
  `token-expiry` as a column filter; `{ raw: true }` opts into full MATCH
  syntax.
- **Current-only export remaps edge endpoints** to the current row of each
  endpoint's claim key: a superseded qualified parent keeps its `WHEN`
  attached to the surviving belief, and orphaned condition claims are never
  promoted to top-level facts.
- **Sensitivity filtering follows current resolution**: the latest row is
  selected before its audience is checked, so a hidden current belief never
  revives an older visible row. Full-history export checks each row. Edges with
  either endpoint hidden are omitted.

## Tests

```
pnpm --filter @cavelang/store test
```

Covers the §9.1 belief series, §5.5 one-fact-two-names invariants
(unified belief through either name, negation riding the row, no
materialized inverses), every §13.5 query, the §13.6 alias closure
(merge, unmerge by retraction, opt-in traversal, union semantics), the
§9.5 provenance stamping (written `@src:` wins, per-actor series,
cross-actor retraction, stamped round-trips), the §26 resolution policy
(human-over-ingest precedence, reliability weighting, longest-prefix
specificity, polarity contests, no self-elevation, alias-widened
groups, contested ranking), the §11.2 topic reads, edge persistence,
registry and lifecycle rebuild across reopen, transactional strict ingest and export
round-trips.
