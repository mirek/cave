---
"@cavelang/cli": patch
---

Reject explicit null viewer limits and stale horizons instead of silently selecting defaults. Validate search limits before opening a read snapshot, while preserving zero limits and defaults for omitted options.
