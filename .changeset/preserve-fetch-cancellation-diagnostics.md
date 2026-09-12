---
"@cavelang/connect": patch
"@cavelang/cli": patch
---

Preserve simultaneous cancellation and transport failures when diagnostic
formatting throws, retaining original aggregate members and cause for both
fetch startup and response-body failures.
