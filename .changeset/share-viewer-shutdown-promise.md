---
"@cavelang/cli": patch
---

Make concurrent and repeated viewer handle close calls share one shutdown result while retaining caller ownership of the store.
