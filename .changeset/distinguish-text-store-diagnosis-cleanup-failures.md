---
"@cavelang/cli": patch
---

Preserve successful text-store diagnosis and its claim count when the temporary store fails to close, reporting a redacted store.cleanup failure instead of a misleading load error.
