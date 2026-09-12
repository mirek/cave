---
"@cavelang/cli": patch
---

Include malformed stored rules in automation report problems when derivation
is enabled, so automate --once reports failure instead of successful settling.
Valid declarations continue running and --no-derive skips rule checks.
