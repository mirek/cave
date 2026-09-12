---
"@cavelang/cli": patch
---

Preserve viewer startup and shutdown failures together, attempt connection cleanup independently, and await listener shutdown before closing the store even when connection termination throws.
