---
"@cavelang/cli": patch
---

Retain primary ingestion exceptions through prompt-directory, strict-stage and standalone configuration cleanup failures. Preserve nested diagnostics and continue outer cleanup, with regressions for rollback and post-commit cleanup boundaries.
