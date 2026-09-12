---
"@cavelang/cli": patch
"@cavelang/shape": patch
---

Keep standalone shape declaration and fact reads in one read snapshot so concurrent revocation cannot produce a false violation from mixed database states.
