---
"@cavelang/cli": patch
"@cavelang/connect": patch
---

Stage absent JSON fields as SQL NULL even when their names match inherited JavaScript properties, preserving explicitly supplied values.
