---
name: database-backed-transaction-order
description: Allocate transaction order safely across concurrent processes.
status: open
priority: high
area: storage
source: bugs-multi-process-tx-order
---

# Database-backed transaction ordering

## Problem

Two processes holding the same SQLite file open can allocate conflicting or incorrectly ordered transaction values despite sequential merge semantics being defined.

## Direction

Move transaction allocation into a database-serialized operation and define retry behavior under contention.

## Done when

- Concurrent writers cannot allocate duplicate or regressing order.
- Lamport receive semantics remain intact.
- Multi-process stress tests cover busy, rollback, and retry paths.
