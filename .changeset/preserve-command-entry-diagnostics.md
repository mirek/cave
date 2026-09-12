---
"@cavelang/cli": patch
---

Retain structured failure output from backup, restore, alias suggestion and reconstruction when setup throws an unprintable value. Reuse the shared safe formatter before owned-store execution as well as during cleanup.
