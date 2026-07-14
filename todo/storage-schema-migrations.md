---
name: storage-schema-migrations
description: Version and migrate SQLite schemas explicitly.
status: open
priority: high
area: storage
source: architecture-review
---

# Storage schema migrations

## Problem

Schema evolution relies on idempotent creation rather than an explicit database version and ordered migrations.

## Direction

Use `PRAGMA user_version` or an equivalent local migration ledger, with transactional forward migrations and compatibility checks.

## Done when

- Every supported database version has a deterministic upgrade path.
- Newer incompatible databases fail with a clear message.
- Migration, interruption, backup, and rollback cases are tested.
