---
"@cavelang/solver": patch
---

Normalize zero rational numerators with string denominators using validated text
without allocating the denominator BigInt. Keep invalid and zero denominator
rejection, and document the measured improvement and nonzero control.
