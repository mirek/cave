---
"@cavelang/cli": patch
---

Capture connector command context at entry so a changing signal getter cannot bypass pre-cancellation and create or modify a database.
