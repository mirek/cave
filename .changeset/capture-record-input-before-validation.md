---
"@cavelang/store": patch
---

Copy object record inputs before validation so changing accessors and caller mutations cannot replace decoded values.
