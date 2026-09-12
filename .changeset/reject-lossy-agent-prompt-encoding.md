---
"@cavelang/cli": patch
---

Reject unpaired Unicode surrogates in shell-agent prompts before UTF-8 encoding can silently alter stdin or temporary prompt-file contents.
