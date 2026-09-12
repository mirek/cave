---
"@cavelang/cli": patch
"@cavelang/ingest": patch
---

Keep unprintable URL transport errors as retryable source outcomes instead of
aborting selection, with healthy-source continuation and retry coverage.
