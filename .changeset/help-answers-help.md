---
"@cavelang/cli": patch
---

`cave help --help` and `cave help help` print the help command's own usage instead of exiting 2 with an unknown-command error, so every command in the reference, `help` included, answers `--help`. `cave version`, `cave demo`, and `cave help` now reject surplus positional arguments with status 2, as `cave doctor` already did, instead of ignoring them; delegated commands such as `cave serve` keep reporting argument errors with status 1.
