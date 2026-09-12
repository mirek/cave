---
"@cavelang/core": patch
---

Consume complete HTTP responses in packed smoke checks so early grep exits cannot turn successful responses into curl broken-pipe failures.
