---
"@cavelang/cli": patch
"@cavelang/ingest": patch
"@cavelang/eval": patch
---

Reject nonnumeric programmatic timeouts without invoking coercion hooks in completion, ingestion and evaluation adapters. Preserve valid whole-millisecond deadlines and existing zero-timeout policies.
