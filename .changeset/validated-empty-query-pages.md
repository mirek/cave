---
"@cavelang/query": patch
---

Validate query syntax, time anchors, and incompatible options even when a
paginated query has no rows at its requested snapshot. CLI text and JSON
requests now reject these errors consistently on empty and populated stores.
