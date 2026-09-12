---
"@cavelang/cli": patch
---

Capture and validate process stdin before launch in both runners, preserving non-enumerable input and preventing getter changes or invalid input from affecting an already-started child.
