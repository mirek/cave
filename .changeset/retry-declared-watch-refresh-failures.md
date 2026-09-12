---
"@cavelang/cli": patch
"@cavelang/connect": patch
---

Report declared watcher refresh failures without rejecting scheduled work, preserving existing subscriptions so the next save can retry.
