---
"@cavelang/store": patch
---

Reject unpaired Unicode surrogates in direct search and lookup arguments before SQLite can replace them and match different stored text.
