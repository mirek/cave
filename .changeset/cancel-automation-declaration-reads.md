---
"@cavelang/cli": patch
---

Stop pending automation declaration stdin reads on cancellation, discard their buffered claims, and remove input listeners without destroying caller-owned streams.
