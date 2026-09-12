---
"@cavelang/cli": patch
"@cavelang/connect": patch
---

Preserve original SQL errors during empty-source column inference when their
messages are unreadable or non-string, without retrying the failed staging run.
