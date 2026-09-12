---
"@cavelang/cli": patch
"@cavelang/rules": patch
---

Avoid unused transaction-head scans for skipped rules, reducing measured 1,000-rule quiet runs from 333 ms to 80 ms.
