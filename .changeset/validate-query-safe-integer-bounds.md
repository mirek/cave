---
"@cavelang/query": patch
---

Reject unsafe integer SQL limits and offsets with a CAVE-Q validation error
before binding them. Preserve support for the full safe-integer range.
