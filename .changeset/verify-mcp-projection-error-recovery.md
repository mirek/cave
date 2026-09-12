---
"@cavelang/cli": patch
---

Verify MCP query projection failures through the SDK stdio transport: malformed
stored identity or provenance returns a tool error without partial matches or
writes, and a query succeeds in the same session after repair.
