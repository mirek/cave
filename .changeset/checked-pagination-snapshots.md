---
"@cavelang/query": minor
"@cavelang/mcp": patch
"@cavelang/cli": patch
---

Detect historical rows and lineage added below a pagination cutoff, rejecting
stale cursors and changes during page construction with a restart instruction.
Preserve continuation across wholly future appends. Version opaque cursors to
include a bounded append revision; keep the public page envelope unchanged.
