---
"@cavelang/cli": patch
---

Preserve literal committed changeset filenames and file contents during release
preflight so unusual paths cannot disappear from the pending set and metadata
validation agrees with CI.
