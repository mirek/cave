---
"@cavelang/cli": patch
---

Keep MCP entity overviews and neighbor traversals in one deferred read snapshot.
Concurrent alias or claim updates no longer mix old selection or forward edges
with new claims or reverse edges in one response. Preserve caller transactions.
