---
"@cavelang/solver": patch
---

Compare normalized integer text before allocating bigint magnitudes, avoiding reparsing in exact-order shortcuts while retaining operand validation and cross-products where needed.
