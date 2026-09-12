---
"@cavelang/cli": patch
---

Finish MCP stdio serving when its output stream closes, releasing transport listeners without waiting for unrelated input cancellation.
