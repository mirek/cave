---
"@cavelang/cli": patch
---

Capture the MCP configuration directory option once so write failures cannot delete caller-owned directories or leak helper-owned directories when a getter changes its value.
