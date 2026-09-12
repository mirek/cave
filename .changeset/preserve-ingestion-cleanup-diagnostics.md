---
"@cavelang/cli": patch
"@cavelang/ingest": patch
---

Preserve ingestion cleanup and cancellation failures when diagnostic formatting
throws, retaining original error chains and strict/lenient write boundaries.
