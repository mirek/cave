---
"@cavelang/cli": patch
---

Preserve SQL.js execution and statement-release errors together instead of
allowing cleanup failures to hide the original error; keep statements reusable
after failed calls.
