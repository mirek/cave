---
"@cavelang/store": patch
---

Keep cleanup-hook registrations independent when components share a callback, so unsubscribing one registration preserves the others.
