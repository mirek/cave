---
"@cavelang/tree-sitter-cave": patch
---

Skip document reads and parsing for already-cancelled VS Code semantic-token
requests while preserving subsequent requests and native-resource cleanup.
