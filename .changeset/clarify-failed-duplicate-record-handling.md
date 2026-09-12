---
"@cavelang/cli": patch
---

Correct duplicate-record diagnostics to identify the last successful record as the winner, and verify that failed duplicates preserve its claims while absent records are pruned.
