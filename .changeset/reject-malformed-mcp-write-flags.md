---
"@cavelang/cli": patch
---

Reject non-boolean ingestion strictness and derivation dry-run/full/alias flags
before writes. Malformed preview flags no longer silently become durable derivations.
