# @cavelang/sync

Store merge (spec §28): two append-only CAVE stores become one, by row
identity. The data model pre-solved the hard part — coexisting
contradictions are legal (§9.4), resolved at read time (§26) — so
merging can never conflict; this package settles what was left open
(ROADMAP open decision 1): transaction semantics across stores.

```ts
import { open } from '@cavelang/store'
import { syncDb } from '@cavelang/sync'

const store = open('main.db')
syncDb(store, 'laptop.db', { from: 'laptop', into: 'main' })
// → { merged: 42, skipped: 108, edges: 17,
//     record: 'store/laptop SYNCED-INTO store/main ; +42 claim(s), +17 edge(s)' }
```

Or from the CLI:

```sh
cave sync --db main.db laptop.db          # store file → merged through SQL
cave export --db laptop.db --tx > l.cave  # §28.4 annotated canonical text
cave sync --db main.db l.cave             # text → replayed under its ids
cave sync --db main.db laptop.db --dry-run --json
```

## What merging means (§28.1–§28.4)

- **The id is the row.** Every append mints one UUIDv7 serving as both
  `id` and `tx`; merge copies rows absent by id *verbatim* (`claim_key`,
  `raw_line`, contexts, tags, FTS) and skips rows the target has.
  Idempotent (re-runs merge nothing), transitive (an absorbed store's
  rows travel onward under their own identity), bidirectional (`a ← b`
  then `b ← a` converges), and never re-stamped — merge is interchange
  replay, so §9.5's no-stamp rule applies.
- **The receive rule.** Opening a store observes its `MAX(tx)`; merging
  observes the merged maximum — the UUIDv7 generator never mints below
  what it observed, so *everything appended after a merge outsorts
  everything merged*, whatever the origin clocks read. Merged history
  itself interleaves by origin wall clock, stated honestly: cross-machine
  recency is physical time; where trust should outrank recency, that is
  the §26 precedence policy, not tx.
- **Merge events are claims.** An effective merge appends
  `store/<from> SYNCED-INTO store/<into> @src:sync ; +N claim(s), +M edge(s)`
  (declaring `SYNCED-INTO IS verb` in-band on first use) — one claim key
  per (origin, target) pair whose belief series is the sync log. A merge
  that changed nothing appends nothing.
- **Text carries identity via transaction annotations.** `cave export
  --tx` precedes every claim line with a `;@ <tx>` comment at matching
  indentation. Comment lines are transparent to the grammar, so every
  existing reader takes the file unchanged and plain `cave import`
  degrades to an ordinary tx-less replay; `syncText` replays each line
  under its recorded id — and is strict about it (every claim annotated,
  no orphaned annotations, no id repeated with different content),
  because a half-annotated file would merge half idempotently and
  duplicate the rest.
- **Re-statements make the tree carry the graph.** A row cited by
  several parents — a premise shared by two derivations, the `VIA` rule
  row every derivation of one rule shares (§24.3), a §24.5 support
  cycle — renders its children once and thereafter re-appears as the
  claim line alone under each citing parent, same `;@` id. On replay an
  identical repeat unions back into one row, each statement contributing
  its edge; a conflicting repeat rejects the file whole.

The same fact recorded independently on both machines arrives as two
rows in one belief series — asserted twice, which is what happened.
Query semantics do not change: current belief is still latest-tx per
key, `--as-of` reconstructs across merged history, and `--resolve`
arbitrates cross-actor contests exactly as within one store.

## Branching (§28.6)

The convention that turns these mechanics into a review workflow: the
**text is the store** — commit the full annotated export, never the
SQLite file — and a branch is a git branch plus a private store rebuilt
from it:

```sh
cave export --db main.db --tx --out knowledge.cave     # regenerate before every commit
git switch -c reorg-auth
cave sync --db work.db knowledge.cave --no-record      # checkout: plumbing, no record
cave add --db work.db …                                # ordinary appends
cave export --db work.db --tx --out knowledge.cave     # the PR diff = the appended claims
```

Rows are immutable and export order is transaction order, so review
diffs only add lines (a derivation may *move* the premise lines it
cites into its indented block — verbatim, annotations included). A
knowledge merge can never conflict; a *text* merge can, and the answer
is never to hand-merge: sync both sides into a fresh store and
re-export the union — configurable as a git merge driver
(`.gitattributes`: `*.cave merge=cave`):

```ini
[merge "cave"]
	name = CAVE store union
	driver = sh -euc 't=$(mktemp -d) && cave sync --db $t/m.db $1 --no-record >/dev/null && cave sync --db $t/m.db $2 --no-record >/dev/null && cave export --db $t/m.db --tx --out $1 && rm -rf $t' - %A %B
```

Landing is a sync — `cave sync --db main.db knowledge.cave --as
reorg-auth` — and this one is a real merge event: let it record. The
honest cost: every branch is a full copy of the store; fine at CAVE's
scale, and stated rather than hidden.

## API

- `syncDb(store, sourcePath, options?)` — merge a store file (SQL
  `ATTACH`, one transaction).
- `syncText(store, text, options?)` — merge §28.4 annotated canonical
  text (ordinary canonicalization pipeline, explicit ids).
- `syncFile(store, sourcePath, options?)` — sniff the SQLite header and
  route; origin label defaults to the file's basename stem.
- Options: `from` / `into` (record labels), `record: false` (skip the
  merge record), `dryRun` (full report inside a rolled-back
  transaction). Reports: `{ merged, skipped, edges, dryRun, record?,
  problems }`.

Sync is an operator surface, deliberately not served over MCP: store
files are machine-local paths, and an agent's write surface stays the
governed §25 vocabulary.
