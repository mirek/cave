---
"@cavelang/cli": patch
"@cavelang/sync": patch
---

Retain the original cause when adding the source filename to a sync schema
validation error, and safely format unusual thrown values. Verify destination
preservation, source detachment and retry in normal and dry-run modes.
