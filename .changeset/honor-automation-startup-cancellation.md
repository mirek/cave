---
"@cavelang/cli": patch
---

Honor an already-aborted automation signal before argument handling and database access, preventing cancelled retractions and creation of empty databases.
