---
"@cavelang/cli": patch
---

Reject malformed MCP reconstruction seed lists and budgets before traversal,
instead of discarding seed entries or silently substituting default budgets.
Advertise nonempty seed strings and nonnegative safe integer budgets in the schema.
