---
"@cavelang/cli": patch
"@cavelang/ingest": patch
---

Reject path-based ingestion batches whose files change or become unreadable before or during an agent call, preserving retry eligibility and strict/lenient ownership.
