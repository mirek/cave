---
"@cavelang/cli": patch
"@cavelang/view": patch
---

Return HTTP 400 for malformed view request URLs instead of reporting a server failure, preserving error headers and HEAD behavior.
