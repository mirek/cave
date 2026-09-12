---
"@cavelang/cli": patch
---

Keep synchronous MCP reconstruction on one deferred database snapshot across
cue expansion and result rendering. Concurrent updates no longer change the
traversed graph partway through one result; later calls see the updated graph.
