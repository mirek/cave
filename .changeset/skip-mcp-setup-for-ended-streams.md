---
"@cavelang/cli": patch
---

Finish MCP serving for already-terminal streams, and drain accepted request replies on normal input EOF so buffered requests are not lost during shutdown.
