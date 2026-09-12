---
"@cavelang/cli": patch
---

Keep SQLite doctor checks in one read transaction so a concurrent writer cannot mix database states within a report; later diagnoses observe subsequent commits.
