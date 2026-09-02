---
"@cavelang/cli": patch
---

`cave help --help` and `cave help help` print the help command's own usage instead of exiting 2 with an unknown-command error, so every command in the reference, `help` included, answers `--help`.
