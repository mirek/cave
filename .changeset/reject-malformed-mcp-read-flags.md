---
"@cavelang/cli": patch
---

Reject malformed boolean read flags across MCP query, fusion, search, entity
reads and export instead of silently changing the requested mode. Preserve
false defaults for omitted flags and validate fusion aliases before selection.
