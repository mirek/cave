---
"@cavelang/cli": patch
---

Preserve ingestion command failures when the final owned-store close also fails. Retain both diagnostics and original error identities while attempting close once, with planning and committed-write regressions.
