---
"@cavelang/store": patch
---

Capture declared claim fields and nested values before deriving storage columns,
semantic identity and emitted text, preventing changing getters from producing
inconsistent stored projections.
