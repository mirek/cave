---
name: read-only-command-databases
description: Stop read-only CLI surfaces from creating or migrating a store when the requested database does not exist.
priority: high
area: cli/store
source: Codex exploratory use
audited-commit: 21a9f5b25d660eed886ce288ab8cbb6fbd4ee16c
audited-at: 2026-07-18
---

# Make read-only commands preserve the filesystem

## Problem

Running a read command against a missing database path silently creates and
initializes a SQLite file. This happened with `query`, `resolve`, `check`,
`export`, and `report`: each command exited successfully and left a 118,784-byte
database behind. For example:

```sh
cave query --db /tmp/cave-explore/missing.db '?x IS ?y'
# no matches
# /tmp/cave-explore/missing.db now exists
```

A typo in a path therefore looks like an empty knowledge base, mutates the
filesystem, and can hide the fact that the intended store was never opened.
The same unrestricted open path may also migrate an existing older store while
the user believes they are only inspecting it.

## Direction

Give non-mutating commands an explicit read-only store-opening path. Opening a
missing explicit database should fail with a concise diagnostic and remediation
instead of creating it. Decide and document the equally non-mutating behavior
for a missing default database. Keep schema creation and migration behind
commands whose contract permits writes.

Audit every CLI and view surface by behavior rather than by command name so
mixed commands such as `suggest-alias --write` retain a deliberate writable
path while their ordinary form stays read-only.

## Done when

- `query`, `resolve`, `check`, `export`, `report`, and `serve` do not create or
  migrate a database.
- Every other non-mutating mode, including dry-run modes, uses the same
  read-only contract.
- A missing explicit path exits nonzero, names the problem, and explains which
  command can initialize a store.
- Tests assert that missing paths remain absent and existing database bytes and
  schema versions remain unchanged after read commands.
- CLI help, package documentation, and the book describe the initialization and
  read-only boundaries consistently.
