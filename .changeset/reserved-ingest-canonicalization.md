---
"@cavelang/store": patch
---

Canonicalize ordinary ingestion inside its write reservation and refresh
vocabulary after peer commits using SQLite's data-version counter. Preserve
the registry and cache marker on rollback, avoiding stale inverse spellings
and repeated declaration scans during local appends.
