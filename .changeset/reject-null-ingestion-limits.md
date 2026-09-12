---
"@cavelang/cli": patch
---

Reject null ingestion timeouts and batch sizes instead of selecting defaults.
Validate batch sizes at run entry before staging, as well as during selection.
