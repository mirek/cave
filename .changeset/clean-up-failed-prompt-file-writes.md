---
"@cavelang/cli": patch
---

Remove shell-agent temporary prompt directories when writing the prompt file fails, preserving the original write error and allowing a clean retry.
