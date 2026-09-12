---
"@cavelang/cli": patch
---

Preserve database sync failures through temporary-table cleanup and source detach, including nested failures. Document rollback versus post-commit detach behavior and cover dry-run, retry and caller-store ownership.
