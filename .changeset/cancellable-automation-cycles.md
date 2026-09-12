---
"@cavelang/cli": minor
---

Add cooperative AbortSignal support to automation settling and watch cycles.
Stop claiming or executing after cancellation, discard late agent replies,
and yield between watch settles so busy daemons can stop cleanly.
