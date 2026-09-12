---
"@cavelang/store": patch
"@cavelang/sync": patch
"@cavelang/cli": patch
---

Validate every explicit replay ID as a canonical lowercase UUIDv7 before any
row is inserted or the receive clock observes an ID. Reject malformed batches
without changing stored data, vocabulary, or future transaction allocation.

Database sync also rejects malformed or mismatched source id/tx values before
copying rows, lineage, or recording a merge.
