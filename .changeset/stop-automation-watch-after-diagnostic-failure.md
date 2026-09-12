---
"@cavelang/cli": patch
---

Stop automation watches cleanly when reporting a poll or cycle error also fails. Observe rejected cycle promises, retain both failures, remove abort listeners, cancel polling and await active work before closing the store.
