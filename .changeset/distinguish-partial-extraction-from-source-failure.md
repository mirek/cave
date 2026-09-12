---
"@cavelang/cli": patch
"@cavelang/ingest": patch
"@cavelang/eval": patch
---

Mark partially accepted stdout batches explicitly so evaluation cannot score source-change failures as successful runs after direct agent writes.
