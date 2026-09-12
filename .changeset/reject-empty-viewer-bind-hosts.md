---
"@cavelang/cli": patch
---

Reject empty and invalid viewer hosts before listener creation so an empty host cannot silently bind an unspecified interface.
