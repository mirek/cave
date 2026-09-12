---
"@cavelang/store": patch
"@cavelang/cli": patch
---

Require the search table to expose its hidden FTS search column, rejecting incompatible virtual tables such as R-trees during schema validation and diagnosis.
