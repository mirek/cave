---
"@cavelang/cli": patch
---

Reject malformed MCP query cutoffs, valid-time anchors and continuation cursors
instead of silently dropping the requested scope or restarting pagination.
