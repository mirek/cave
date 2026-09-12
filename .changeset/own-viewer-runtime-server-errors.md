---
"@cavelang/cli": patch
---

Make viewer runtime HTTP server errors initiate owned command shutdown, preserving diagnostics and releasing listener, store and abort subscriptions.
