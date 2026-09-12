---
"@cavelang/cli": patch
---

Capture MCP connection scope fields and copy permission/tool lists at setup.
Caller mutations no longer change action permissions on an existing connection;
permitted action declarations remain dynamic within the captured scope.
