---
name: read-only-command-databases
description: Stop read-only CLI surfaces from migrating an older store in place when the user only meant to inspect it.
priority: medium
area: cli/store
source: Codex exploratory use
audited-commit: 21a9f5b25d660eed886ce288ab8cbb6fbd4ee16c
audited-at: 2026-07-18
---

# Make read-only commands preserve the store's schema version

## Problem

Read-only commands no longer create a database at a missing path (spec
§13.7: a missing `--db` is an error for every surface that only reads, and a
CAVE text file replays into memory). The remaining gap is migration: every
open path still runs `Schema.init`, so a read command against an older store
migrates it in place while the user believes they are only inspecting it.
`cave doctor` already opens read-only and reports the pending migration
instead of applying it.

## Direction

Give `openAt(path, { intent: 'read' })` a read-only SQLite open that skips
`Schema.init` when the stored version is current and fails with the doctor's
remediation (back up, then open with a writing command) when it is older.
Keep schema creation and migration behind commands whose contract permits
writes.

## Done when

- `query`, `resolve`, `check`, `export`, `report`, `serve`, and every other
  read intent leave an older store's bytes and schema version unchanged and
  say which command migrates it.
- Tests assert that existing database bytes and schema versions remain
  unchanged after read commands.
- CLI help, package documentation, and the book describe the migration
  boundary consistently.
