---
"@cavelang/store": patch
---

Keep resolution policy and claim selection on one deferred read snapshot for
resolved beliefs, contests and resolved traversals, preventing mixed-state results
under concurrent writes. Capture traversal options once before reading.
