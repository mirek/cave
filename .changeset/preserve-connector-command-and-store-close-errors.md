---
"@cavelang/cli": patch
---

Preserve connector command failures alongside final store-close failures across direct, declared, query, dry-run, listing, and watch lifetimes.

Make the failed-discovery cleanup test inspect its owned temporary directory so concurrent test processes cannot change its result.
