---
"@cavelang/cli": patch
---

Stop already-cancelled direct MCP and HTTP viewer invocations before database access or service startup, matching the shared CLI cancellation boundary.
