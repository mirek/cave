---
name: multi-process-tx-order
description: Define or enforce current-belief ordering across concurrent writers.
severity: low-design
area: "@cavelang/core, @cavelang/store"
source: gpt-5.5-thinking
files:
  - packages/core/src/uuidv7.ts
  - packages/store/src/store.ts
---

# Current-belief ordering relies on process-local UUIDv7 monotonicity

## Problem

Current belief is resolved by `MAX(tx)` per `claim_key`. The UUIDv7 generator
is strictly monotonic only within a single process.

Since 0.19.0 the spec section 28.2 receive rule (`Uuidv7.observe` in
`packages/store/src/store.ts`) observes a store's `MAX(tx)` at open and after
merge, so sequential multi-process writes and post-merge appends order
correctly. The issue remains for two processes holding the same database file
open concurrently: each generator only observes at open, so a slow-clock
process can mint a transaction below a fast-clock peer's fresh append.

## Impact

With multiple processes writing to the same SQLite database under skewed
clocks, “latest” can be wrong. This may be acceptable for a local single-writer
tool, but it is currently an implicit invariant.

## Direction

Document single-writer expectations clearly. If multi-process writes are
intended, add a SQLite-controlled commit sequence column and use that to
resolve current-belief ordering.
