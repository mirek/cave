---
"@cavelang/solver": patch
---

Avoid unnecessary products in local explanation comparisons when normalized signs, zero values, or shared components determine the order. Compare remaining cross-products directly, and verify all comparison operators against an independent rational-order oracle.
