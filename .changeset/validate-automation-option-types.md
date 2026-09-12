---
"@cavelang/cli": patch
---

Reject malformed automation mode flags, null limits and nonnumeric hook timeouts
before durable work. Timeout validation no longer invokes object coercion.
