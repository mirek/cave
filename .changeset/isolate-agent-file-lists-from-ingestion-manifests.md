---
"@cavelang/cli": patch
---

Isolate function-agent file lists from ingestion batch membership so adapter mutation cannot corrupt manifests or discard successful strict runs.
