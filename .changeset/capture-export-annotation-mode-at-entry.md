---
"@cavelang/store": patch
---

Capture export transaction-annotation mode before database reads so callbacks cannot remove requested replay identities midway through export.
