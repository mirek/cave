---
"@cavelang/cli": patch
---

Reject malformed programmatic action dryRun, check and aliases settings before
execution. String preview flags can no longer enter the durable write path;
valid boolean settings and omitted defaults retain their existing behavior.
