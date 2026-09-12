---
"@cavelang/cli": patch
---

Verify installed action and proposal timeout validation rejects null and other
malformed values without writes, hook lookup or coercion, then permits recovery.
