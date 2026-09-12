---
"@cavelang/cli": patch
---

Include literal import.meta.resolve lookups in the CLI runtime dependency guard.
Undeclared or development-only lookup targets now fail the package build.
