---
"@cavelang/store": minor
---

Expose outermost transaction ownership to store callbacks across SQLite adapters. Reject configured action hooks inside caller-owned transactions when effects would change, rolling back the action's savepoint without firing the hook or disturbing earlier caller writes. Preserve nested hook-free, no-op, and dry-run actions.
