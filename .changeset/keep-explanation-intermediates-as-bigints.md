---
"@cavelang/solver": patch
"@cavelang/cli": patch
---

Normalize explanation arithmetic directly as bigints, avoiding repeated decimal serialization and parsing while preserving exact fraction, sign and zero behavior.
