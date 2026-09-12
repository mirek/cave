---
"@cavelang/cli": patch
---

Reject malformed UTF-8 in the shared CAVE file/stdin reader before parsing or ingestion can silently replace bytes.
