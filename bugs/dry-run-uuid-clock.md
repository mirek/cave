---
name: dry-run-uuid-clock
description: Keep text-sync dry-runs from changing later transaction ordering.
severity: low-design
area: "@cavelang/sync"
source: "https://github.com/mirek/cave/pull/20"
files:
  - packages/sync/src/sync.ts
---

# Text-sync dry-runs mutate the process UUID clock

## Problem

Dry-run text sync still calls `insertResult` with explicit transaction IDs
inside a rolled-back SQLite transaction. UUID observation is process state, so
a future imported UUID advances later locally minted IDs even though the
database write rolls back.

## Impact

A command advertised as writing nothing changes subsequent transaction
ordering in the process.

## Direction

Validate without observing IDs, or snapshot and restore generator state around
dry-runs.
