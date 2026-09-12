---
"@cavelang/cli": patch
---

Validate MCP stdio input as streaming UTF-8 before SDK decoding, rejecting malformed bytes and incomplete EOF sequences instead of silently storing replacement text.
