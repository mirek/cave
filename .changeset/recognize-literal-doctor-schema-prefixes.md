---
"@cavelang/cli": patch
---

Match literal CAVE object prefixes during diagnosis so unrelated SQLite tables such as caveat do not produce misleading migration guidance. Preserve case-insensitive detection and read-only behavior.
