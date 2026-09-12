---
"@cavelang/cli": patch
---

Resolve shared shape vocabulary lazily so attribute-only checks avoid replaying unrelated peer declarations, while later relation checks refresh normally.
