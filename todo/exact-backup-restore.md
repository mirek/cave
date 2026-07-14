---
name: exact-backup-restore
description: Preserve temporal semantics through backup and restore.
status: open
priority: high
area: storage
source: architecture-review
---

# Exact backup and restore

## Problem

Text export is an escape hatch, not a byte- or history-equivalent backup: replay can change transaction order, as-of results, and staleness relationships.

## Direction

Provide a documented exact backup/restore path using SQLite-safe snapshot semantics, distinct from portable text export.

## Done when

- Restored stores preserve row identity, transaction order, provenance, and history.
- Online backup behavior is safe with WAL and concurrent readers.
- Verification instructions and failure recovery are documented.
