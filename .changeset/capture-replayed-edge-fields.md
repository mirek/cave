---
"@cavelang/store": patch
---

Capture canonical-result edge fields before insertion so replay duplicate checks
and writes cannot use different roles from a changing getter.
