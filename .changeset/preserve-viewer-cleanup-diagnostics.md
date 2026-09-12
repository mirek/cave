---
"@cavelang/cli": patch
---

Preserve combined viewer startup and cleanup failures when diagnostic formatting
throws. Share the HTTP handler's safe formatter and retain original aggregate
members, cause and cleanup ordering.
