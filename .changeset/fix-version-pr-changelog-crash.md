---
"@cavelang/core": patch
---

Fix the release automation's first run: changesets/action builds the version packages PR body from each changed package's `CHANGELOG.md`, so `changelog: false` crashed it (ENOENT). Changelogs are now generated with the built-in `@changesets/cli/changelog`, and `scripts/sync-versions.mjs` no longer bumps the private website/VS Code manifests (changesets never writes changelogs for them, and the action treated their sync as a package release).
