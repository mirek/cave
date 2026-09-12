---
"@cavelang/cli": patch
"@cavelang/ingest": patch
---

Retain ingestion command output and final-close errors when diagnostics cannot
be formatted, covering planning and execution without changing committed writes.
