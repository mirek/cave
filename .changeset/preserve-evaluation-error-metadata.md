---
"@cavelang/cli": patch
"@cavelang/eval": patch
---

Preserve evaluation cleanup and cancellation failures when diagnostic messages
or nested error metadata cannot be read, without continuing cancelled runs.
