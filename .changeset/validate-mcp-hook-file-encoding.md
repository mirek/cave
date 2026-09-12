---
"@cavelang/cli": patch
---

Reject malformed UTF-8, unpaired Unicode surrogates, and blank hook names during MCP configuration validation, before database or protocol startup.
