---
"@cavelang/sync": patch
"@cavelang/cli": patch
---

Reject database sync when an existing row ID names different claim data or
explicit provenance, before copying rows, lineage, or a merge record. Preserve
compatibility with text replay, metadata reordering, and inferred provenance.
Report conflicting IDs in text and JSON, including dry runs.
