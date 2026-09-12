---
"@cavelang/cli": patch
---

Preserve completed doctor checks when the owned database connection fails to close, adding a redacted store.cleanup failure in text and JSON reports instead of throwing away the report.
