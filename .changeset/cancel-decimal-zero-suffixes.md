---
"@cavelang/solver": patch
---

Cancel decimal coefficient trailing zeros against the scale before constructing bigint operands, avoiding large denominators and GCD work for compact rational values.
