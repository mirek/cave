---
"@cavelang/cli": patch
---

Apply shared source-token validation to programmatic MCP calls and CLI --src.
Malformed explicit values no longer silently select default provenance or reach
writes; false still disables stamping and omission uses the agent source.
