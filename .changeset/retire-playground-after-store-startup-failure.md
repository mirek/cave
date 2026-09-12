---
"@cavelang/cli": patch
---

Retire the playground worker when its store fails to initialize, including when
startup cleanup also fails, so Rebuild starts a fresh runtime. Preserve startup
diagnostics and original causes.
