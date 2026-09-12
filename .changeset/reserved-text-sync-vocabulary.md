---
"@cavelang/cli": patch
"@cavelang/sync": patch
---

Reserve annotated-text sync before refreshing vocabulary, validating, and
canonicalizing input. Honor inverse declarations committed by another writer
before the merge, while keeping dry-run registry and UUID state restoration.
