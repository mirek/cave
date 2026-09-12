---
"@cavelang/cli": patch
---

Keep unprintable store exceptions inside the HTTP request handler. Return a
stable JSON error response instead of throwing while formatting diagnostics,
with regression coverage for GET, HEAD and subsequent request recovery.
