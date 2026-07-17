---
"@cavelang/core": patch
---

Validate authoritative release commits and tags before npm setup, align the
publish runtime with CI, cache the tree-sitter toolchain, and retry registry
reads without confusing transient failures for unpublished packages.
