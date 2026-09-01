#import "../style.typ": note, file, recap

= Two Stores Become One

Knowledge accumulates on more than one machine: a laptop and the shop
counter, a store and its air-gapped copy. Eventually one must absorb the
other. The data model has already done the hard part, because contradictory
claims coexist and resolve at read time, so a merge can never conflict.
This chapter covers `cave sync`, the annotated text form that carries row
identity, and the git workflow they compose into.

== Rows have global identity

Every appended row is minted one UUIDv7 that serves as its id and its
transaction. Merging copies rows that are absent *by id*, verbatim, and
skips rows the target already has. Build two stores that share a history
and then diverge:

```sh
$ cave add --db laptop.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave backup --db laptop.db --out shop.db >/dev/null

$ echo 'cafe/harbour HAS manager: "Sam"' | cave add --db shop.db
added 1 claim(s), 0 edge(s)

$ echo 'lot/huila-26 HAS score: 86.5 @src:q-grader/ana @ 80%' | cave add --db laptop.db
added 1 claim(s), 0 edge(s)

$ cave sync --db laptop.db shop.db
merged 1 claim(s), 0 edge(s), 33 already present
record: store/shop SYNCED-INTO store/laptop ; +1 claim(s), +0 edge(s)

$ cave sync --db laptop.db shop.db
merged 0 claim(s), 0 edge(s), 34 already present
```

Everything follows from identity preservation. Re-running merges nothing.
Merges are transitive: after the shop absorbs a third store, syncing the
shop into the laptop carries the third store's rows under their original
ids, and a later direct sync finds them present. Two stores syncing each
other converge. And the same fact recorded independently on both machines
arrives as two rows in one belief series, asserted twice, which is what
happened; resolution and fusion apply at read time exactly as within one
store. Rows are never re-stamped on merge, because re-minting ids would
fork identity and duplicate every row on the next sync.

== The merge is a claim

A merge that changed anything is recorded in the target store as an
ordinary claim, `store/<from> SYNCED-INTO store/<into>`, stamped
`@src:sync`, with the batch counts in its comment. The labels default to
file basenames and can be set with `--as` and `--into`; the claim key is one
per origin-and-target pair, so its belief series is the sync log. A sync
that merged nothing appends nothing. `--dry-run` computes the full report
inside a rolled-back transaction.

== The receive rule

A store that absorbs rows from a fast-clocked machine holds rows stamped
ahead of its own wall clock. If its next append sorted before them, it
would silently lose currency to the merged past. So every append receives
a transaction greater than every transaction already in the store: the id
generator observes the maximum on open and after every merge and never
mints below it. Local appends always win locally. Merged history
interleaves by origin clocks, so cross-machine recency is physical time,
not causality; where trust should outrank recency, that is precedence
(Chapter 11), not transaction order.

== Text that carries identity

Canonical export deliberately omits transaction ids, which is right for
restoring and wrong for merging. `--tx` adds them as a full-line comment
above each claim, and `cave sync` accepts that text, or `-` for standard
input:

```sh
$ cave export --db shop.db --tx --max-sensitivity restricted | grep -B1 'manager'
  ;@ <uuid>
  HAS manager: "Sam" @src:cli

$ cave export --db shop.db --tx --max-sensitivity restricted --out shop.cave
exported 34 claim(s) to shop.cave

$ cave sync --db laptop.db shop.cave --as shop-export
merged 0 claim(s), 0 edge(s), 34 already present
```

The annotation sits at the claim's own indentation, here inside the factored
`cafe/harbour` block. Every other reader sees ordinary comments, so `cave import` of an annotated
file is an ordinary replay with fresh ids, and every existing consumer
reads the file unchanged. `cave sync` is strict the other way: every claim
line must be annotated with a well-formed id, or the file is rejected
whole, because a half-annotated file would merge half a store idempotently
and duplicate the rest on every run. A shared row cited by several parents
is restated with the same id and unions back into one row on replay; the
same id with different content forks identity and rejects the file.
`--max-sensitivity restricted` makes the export complete; a `--current`
export with `--tx` is a seed whose rows keep their identity, so a store
grown from it merges back without duplication.

== The store under git

Because the annotated export is a complete replica, the text can be the
store. Commit `knowledge.cave`, never the SQLite file, regenerated before
every commit and never edited by hand. A branch is a git branch plus a
private store file, rebuilt from the text as plumbing:

// no-test
```sh
$ git switch -c reorg-suppliers
$ cave sync --db work.db knowledge.cave --no-record
$ cave add --db work.db suppliers.cave
$ cave export --db work.db --tx --max-sensitivity restricted --out knowledge.cave
```

The pull-request diff is the appended claims: review new `;@` ids as the
semantic additions, and treat a changed physical line around an existing
id as presentation, since canonical output may factor an old and a new row
through a shared prefix. A knowledge merge can never conflict; a *text*
merge can, when two branches append at the end of the file. Never
hand-merge the export. Rebuild it as the union the two texts already are:

// no-test
```sh
$ t=$(mktemp -d)
$ cave sync --db $t/m.db ours.cave --no-record
$ cave sync --db $t/m.db theirs.cave --no-record
$ cave export --db $t/m.db --tx --max-sensitivity restricted --out knowledge.cave
```

Git can run that as a merge driver for `*.cave` files; the ancestor is
unused because union by identity needs no three-way merge. Landing the
branch is one more sync into the live store, and this one is a real merge
event, so let it record. Refreshing a stale branch is the same move pointed
the other way, as a checkout.

Costs, stated plainly: a branch is a full copy of the store, with no shared
structure, and divergence between the committed text and anyone's live
store is bounded by the next sync, not prevented. Both are the right trade
at CAVE's scale, one machine and one SQLite file, with plain text as the
escape hatch. Sync is deliberately not an MCP tool: store files are
machine-local paths, and distribution is the operator's concern.

#recap[`cave sync --db target <source>` merges rows by UUIDv7 identity from
a store file or `;@`-annotated text; present rows skip, re-runs merge
nothing, and an effective merge appends a `SYNCED-INTO` record. Every
append outsorts everything merged. `cave export --tx --max-sensitivity
restricted` is a complete replica you can commit; rebuild working stores
from it with `--no-record`, and resolve text conflicts by re-exporting the
union.]
