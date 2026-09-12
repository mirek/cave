---
"@cavelang/solver": patch
---

Normalize BigInt intermediates directly in linear analysis and explanation arithmetic, avoiding redundant decimal serialization and reparsing. Record before/after benchmark samples, including cancelling controls and the limits of the measured improvement.
