---
"@cavelang/store": patch
---

Refuse backup publication when the destination has SQLite sidecars, even with force, and prevent restore from writing into its source snapshot's sidecar paths.
