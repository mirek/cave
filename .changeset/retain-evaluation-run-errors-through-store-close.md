---
"@cavelang/cli": patch
---

Preserve cancellation and caught work exceptions when extraction or reconstruction evaluation stores fail to close. Retain ordinary failed-run reports when close succeeds, stop after close failure, and respect keep policy.
