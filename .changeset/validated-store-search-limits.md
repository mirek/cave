---
"@cavelang/store": minor
---

Require direct search limits to be non-negative safe integers so negative SQLite limits cannot silently remove the cap. Zero remains supported; omitted limits remain unlimited.
