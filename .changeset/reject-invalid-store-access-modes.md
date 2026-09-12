---
"@cavelang/store": patch
"@cavelang/cli": patch
---

Validate direct store access modes before invoking SQLite adapters so unsupported values cannot fall through to writable connections or unrelated schema errors.
