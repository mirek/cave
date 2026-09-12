---
"@cavelang/store": patch
---

Limit current-export historical identity maps to IDs referenced by edges, avoiding
materialization of unrelated revisions while preserving qualifier remapping.
