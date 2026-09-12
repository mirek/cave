---
"@cavelang/solver": patch
---

Normalize exact decimal expansions with nonpositive scales directly as integer
text, preserving validation, signs and zero while avoiding BigInt conversion
and powers of ten. Fractional scales retain exact rational reduction.
