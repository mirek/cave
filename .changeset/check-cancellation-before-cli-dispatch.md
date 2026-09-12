---
"@cavelang/cli": patch
---

Check cancellation before selecting or loading a CLI command so already-cancelled invocations consistently avoid command-specific I/O, including help output.
