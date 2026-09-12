---
"@cavelang/solver": patch
---

Normalize validated integer-string numerators over denominators 1 or -1 directly
from text, avoiding a large BigInt parse/serialization round trip while
preserving signs, leading-zero normalization and input validation.
