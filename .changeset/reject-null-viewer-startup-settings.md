---
"@cavelang/cli": patch
---

Reject explicit null port, host and sensitivity settings before starting the HTTP viewer instead of silently selecting defaults. Omitted settings retain their defaults.
