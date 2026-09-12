---
"@cavelang/cli": patch
---

Retire every obsolete declared-watch subscription even when closing fails, preserving diagnostics and allowing reintroduced source paths to receive fresh watchers. Add lifecycle regressions covering late callbacks, repeated paths and subsequent ingestion.
