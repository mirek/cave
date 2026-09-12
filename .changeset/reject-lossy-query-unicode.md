---
"@cavelang/query": patch
---

Reject unpaired UTF-16 surrogates in textual and structured queries before SQLite can turn them into replacement-character matches.
