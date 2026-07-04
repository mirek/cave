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
store.exportText({ current: true })          // canonical CAVE text back out
```

## Semantics

- **Append-only** (§9.1): `ingest` only inserts; every row carries a
  monotonic UUIDv7 in `id` and `tx`, so `MAX(tx)` per `claim_key` is the
  current belief. Each ingest call is one SQLite transaction.
- **One row per fact** (§13.3): inverse writes are canonicalized before
  keying (`@cavelang/canonical`), inverse *reads* are query-time views —
  `forward()` uses the subject index, `reverse()` the object index with the
  relation named via the registry's `inverseOf`. Nothing is materialized.
- **Registry persistence is in-band**: `REVERSE` and `X IS verb` claims are
  ordinary rows; on open the store replays them (in tx order) on top of the
  initial registry, which defaults to the standard §5.5 prelude pairs. The
  replay predicate mirrors the canonicalizer exactly — qualifier-condition
  rows never declare, and `X IS verb` needs a verb-shaped subject — so the
  registry after reopen equals the registry at close.
- **Traversal defaults**: `forward`/`reverse`/`topicMembers`/`topicsOf`
  read *current beliefs* and skip negated (`VERB NOT`) and retracted
  (`@ 0%`) rows; opt back in with `{ negated: true, retracted: true }`.
  Contradictions still coexist as rows (§9.4) — resolution belongs to the
  query layer.

## API

| Method | Spec | Purpose |
|---|---|---|
| `ingest(text, {strict})` | §13.4 | parse → canonicalize → append; lenient by default |
| `insertResult(result)` | | append a pre-canonicalized `@cavelang/canonical` result |
| `currentBeliefs({minConf})` | §13.5 | latest row per key |
| `currentBelief(key)` / `history(key)` | §9.1 | one fact's belief series |
| `claimsAbout(entity)` | §13.5 | both directions, all rows |
| `forward(entity)` / `reverse(entity)` | §13.3 | named traversal, inverse-aware |
| `byTag(key, value?)` | §13.5 | flat (`value` omitted → `IS NULL`) or scoped |
| `byContext(ctx)` | §13.5 | context filter |
| `topicMembers(t)` / `topicsOf(e)` | §11.2 | topic layer over `CONTAINS` |
| `search(q, {raw})` | §13.2 | FTS5; literal phrase by default |
| `edgesOf(id)` | §13.2 | qualifier/grouping edges with roles |
| `toClaim(row)` | | reconstruct the canonical claim + side tables |
| `exportText({current})` | | emit canonical CAVE text |
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
  ordered by line.
- **`search()` phrase-quotes by default** — FTS5 would parse
  `token-expiry` as a column filter; `{ raw: true }` opts into full MATCH
  syntax.
- **Current-only export remaps edge endpoints** to the current row of each
  endpoint's claim key: a superseded qualified parent keeps its `WHEN`
  attached to the surviving belief, and orphaned condition claims are never
  promoted to top-level facts.

## Tests

```
pnpm --filter @cavelang/store test
```

Covers the §9.1 belief series, §5.5 one-fact-two-names invariants
(unified belief through either name, negation riding the row, no
materialized inverses), every §13.5 query, the §11.2 topic reads, edge
persistence, registry rebuild across reopen, transactional strict ingest
and export round-trips.
