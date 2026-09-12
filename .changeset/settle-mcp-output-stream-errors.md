---
"@cavelang/cli": patch
---

Reject MCP output-stream failures after transport cleanup instead of leaving the serving promise waiting for unrelated input or cancellation.
