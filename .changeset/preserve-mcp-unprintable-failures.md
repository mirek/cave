---
"@cavelang/mcp": patch
"@cavelang/cli": patch
---

Preserve MCP operation and cleanup failures when thrown values cannot be
formatted. Use a stable diagnostic fallback without replacing original errors,
and cover source-token rejection through the CLI before database startup.
