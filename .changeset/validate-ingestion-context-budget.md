---
"@cavelang/cli": patch
---

Validate ingestion context claim limits before reading the store, rejecting invalid budgets that silently disabled or exceeded the cap.
