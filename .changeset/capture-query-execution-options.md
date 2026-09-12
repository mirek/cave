---
"@cavelang/query": patch
---

Capture query options before historical vocabulary lookup, SQL compilation and post-filtering so changing getters cannot move the transaction boundary or row cap.
