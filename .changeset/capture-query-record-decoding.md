---
"@cavelang/query": patch
---

Capture object query records before validation so changing getters and later
caller mutation cannot invalidate decoded bindings or interpolation metadata.
Retain plain-object binding map validation.
