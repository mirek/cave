---
"@cavelang/core": patch
---

Prevent late Vite watched-file additions from reopening Chokidar during shutdown, with a deterministic shutdown-hook regression and natural-exit checks.
