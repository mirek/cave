---
"@cavelang/store": patch
---

Encode embedded quotes in literal searches for FTS4 separately from FTS5, so browser searches preserve phrase matching instead of silently returning no matches. Raw full-text syntax remains engine-specific.
