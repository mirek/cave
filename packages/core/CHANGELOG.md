# @cavelang/core

## 0.28.1

### Patch Changes

- 16344ea: Harden the release publish script against partial publishes: the already-published guard now checks every public package (not a single sentinel), `pnpm -r publish` retries only publish what's missing, the `v<version>` tag is created on a later run if an earlier one published everything but died before tagging, and first-ever packages (which npm trusted publishing cannot cover until they exist on the registry) are called out up front.

## 0.28.0

### Patch Changes

- e2a4fd7: Release automation via changesets: PRs add a `.changeset/*.md` file instead of bumping versions in lockstep (which made every pair of concurrent PRs conflict); an automated Version Packages PR accumulates pending releases, and merging it bumps all version sources, publishes to npm and tags `v<version>`.
- a0a4dd1: Fix the release automation's first run: changesets/action builds the version packages PR body from each changed package's `CHANGELOG.md`, so `changelog: false` crashed it (ENOENT). Changelogs are now generated with the built-in `@changesets/cli/changelog`, and `scripts/sync-versions.mjs` no longer bumps the private website/VS Code manifests (changesets never writes changelogs for them, and the action treated their sync as a package release).
