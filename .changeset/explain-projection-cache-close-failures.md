---
"@cavelang/cli": patch
---

Include individual diagnostics when multiple cached view projections fail to
close. Preserve all original errors and complete remaining cleanup even when
one diagnostic cannot be formatted.
