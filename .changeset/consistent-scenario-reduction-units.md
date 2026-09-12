---
"@cavelang/scenario": patch
---

Reject mixed units in numeric sum, min and max reductions instead of adding or comparing raw magnitudes and reporting a misleading unit. Check units after explicit conversions; all continues to preserve individual values and units.
