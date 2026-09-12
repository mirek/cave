---
"@cavelang/store": patch
---

Reject unpaired UTF-16 surrogates in claim and metadata text before appending or observing replay IDs, preventing silent UTF-8 replacement during SQLite storage.
