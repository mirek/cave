---
"@cavelang/core": patch
---

Drain CLI output in packed smoke assertions to avoid early-consumer broken pipes while preserving producer exit failures under pipefail.
