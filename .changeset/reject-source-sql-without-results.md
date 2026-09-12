---
"@cavelang/cli": patch
---

Reject source SQL without result columns before execution, preventing VACUUM INTO side effects and mutation statements from masquerading as empty record sources.
