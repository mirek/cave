---
"@cavelang/cli": patch
---

Keep owned-store cleanup and completed command output intact when a thrown value cannot be formatted. Synchronous and asynchronous wrappers now use a stable diagnostic placeholder while preserving simultaneous work and close failures.
