---
"@cavelang/automate": patch
---

Hooks that exit without reading stdin (e.g. `true`) no longer flake as failed steps: `spawnSync` reports `EPIPE` on the unread input pipe when the hook wins the race against the write — likelier on loaded CI runners — even though the command ran and exited 0. Both hook runners (`@cavelang/automate` settle steps and `@cavelang/act` post-commit hooks) now ignore stdin `EPIPE` and judge the hook by its exit status.
