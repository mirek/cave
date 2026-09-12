---
"@cavelang/store": patch
---

Reject NUL-bearing full-text queries before SQLite can truncate raw syntax or report misleading phrase errors.
