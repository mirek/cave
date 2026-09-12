---
"@cavelang/cli": patch
---

Keep MCP fusion estimate selection and alias grouping within one deferred read
snapshot. Concurrent alias updates no longer split a previously selected quantity
mid-call. Preserve caller transaction ownership and combined read/cleanup failures.
