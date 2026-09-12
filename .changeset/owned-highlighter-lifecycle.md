---
"@cavelang/highlight": minor
---

Give factory-created highlighters an idempotent close method to release parser/query resources, while preserving the process-wide shared highlighter's borrowed interface.
