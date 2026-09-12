---
"@cavelang/cli": patch
---

Reject invalid entity activity limits before reading the store instead of silently coercing or slicing with negative and fractional values; retain zero-limit and default behavior.
