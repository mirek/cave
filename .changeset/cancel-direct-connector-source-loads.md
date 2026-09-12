---
"@cavelang/cli": patch
"@cavelang/connect": patch
---

Propagate caller cancellation through direct connector URL fetches and body reads, and reject returned records before mapping or committing after abort.
