---
"@cavelang/store": patch
---

Refresh cached vocabulary on registry access and inverse reads after another
SQLite connection commits, including on read-only connections. Live queries
recognize new inverse and lifecycle declarations without reopening or ingesting.
