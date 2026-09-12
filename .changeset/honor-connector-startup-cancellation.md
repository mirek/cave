---
"@cavelang/cli": patch
---

Stop already-cancelled direct connector invocations before argument handling, source reads, or database access, matching the shared CLI startup boundary.
