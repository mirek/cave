---
"@cavelang/shape": patch
"@cavelang/cli": patch
---

Verify and document that shape-gate rollback failures preserve the original rejection and cleanup error, with recovery through caller rollback or closing/reopening the store and no persisted rejected history or vocabulary.
