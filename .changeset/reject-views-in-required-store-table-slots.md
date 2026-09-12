---
"@cavelang/store": patch
"@cavelang/cli": patch
---

Reject views substituted for required SQLite tables during schema validation, so opening and diagnosis catch incompatible stores before later table operations fail.
