---
"@cavelang/cli": patch
---

Serialize viewer API responses before sending headers so serialization failures return HTTP 500 instead of escaping the server's request handler.
