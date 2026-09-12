---
"@cavelang/cli": patch
---

Reject invalid explicit connector source formats before file or network access instead of bypassing parsing or silently inferring a format for null. Preserve automatic detection when the format is omitted.
