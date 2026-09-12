---
"@cavelang/query": patch
---

Keep queryRecords matching and structured-record projection in one read snapshot, preventing concurrent tag or provenance changes from mixing database states. Preserve caller transactions and projection errors.
