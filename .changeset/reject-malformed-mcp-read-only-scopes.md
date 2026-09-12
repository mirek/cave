---
"@cavelang/cli": patch
---

Reject non-boolean programmatic MCP readOnly settings during scope calculation
and server setup, rather than treating them as false and exposing write tools.
