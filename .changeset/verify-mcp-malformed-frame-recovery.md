---
"@cavelang/cli": patch
---

Verify that malformed stdio frames do not block later valid MCP requests or EOF draining, and document the distinction between discarded frames and protocol error replies.
