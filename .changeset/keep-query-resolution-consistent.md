---
"@cavelang/query": patch
---

Read resolved query policy, vocabulary and candidate claims within one deferred
database snapshot, preventing mixed results across concurrent writes. Preserve
caller transactions and combined read/release errors.
