---
"@cavelang/cli": patch
---

Reject an explicit null action hook timeout before execution instead of silently
using the default. Omission retains the default and numeric zero remains unlimited.
