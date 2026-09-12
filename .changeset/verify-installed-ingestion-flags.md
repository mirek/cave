---
"@cavelang/cli": patch
---

Fix installed ingestion MCP config generation by resolving the exported MCP module
and its bundled sibling executable. Verify malformed flags preserve caller files
and corrected boolean settings generate usable configuration.
