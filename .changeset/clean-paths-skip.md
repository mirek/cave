---
'@cavelang/ingest': patch
---

Preserve digest provenance for file paths that are not valid CAVE entity atoms, so unchanged files with spaces or metadata-like prefixes are skipped on later ingestion runs.
