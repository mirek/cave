---
"@cavelang/store": patch
---

Capture append options and their arrays once so replay validation and insertion
use the same IDs and batch metadata even when callers supply changing getters.
