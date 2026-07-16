---
"@cavelang/store": minor
"@cavelang/query": minor
"@cavelang/cli": minor
"@cavelang/connect": patch
"@cavelang/mcp": patch
---

Add storage-independent `cave.claim/v1` and `cave.query-match/v1` records with
strict decoders and compatibility fixtures, and use them for CLI and federated
JSON instead of serializing internal SQLite columns.
