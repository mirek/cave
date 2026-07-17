# @cavelang/automate

## 0.28.2

### Patch Changes

- 387edea: Separate actor, physical source, lifecycle run, and domain provenance while
  preserving compact contexts, claim identity, export, and legacy stores.

## 0.28.1

### Patch Changes

- 16344ea: Hooks that exit without reading stdin (e.g. `true`) no longer flake as failed steps: `spawnSync` reports `EPIPE` on the unread input pipe when the hook wins the race against the write — likelier on loaded CI runners — even though the command ran and exited 0. Both hook runners (`@cavelang/automate` settle steps and `@cavelang/act` post-commit hooks) now ignore stdin `EPIPE` and judge the hook by its exit status.
- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/act@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/loop@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/rules@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/act@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/loop@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/rules@0.28.0
  - @cavelang/store@0.28.0
