---
"@cavelang/cli": patch
---

Reject invalid or repeated HTTP viewer alias settings with a clear 400 response instead of silently disabling expansion. Preserve omitted and explicit 0/1 behavior and HEAD response semantics.
