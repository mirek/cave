---
"@cavelang/cli": patch
---

Report automation polling watermark failures and retry on the next poll without advancing the processed boundary. Ignore cancelled timer callbacks and verify recovery processes pending events exactly once.
