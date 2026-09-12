---
"@cavelang/store": patch
---

Return immediately when scoped export selects no claims, avoiding unused lineage
scans and historical ID maps while preserving sensitivity and snapshot behavior.
