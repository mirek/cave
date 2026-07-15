# CAVE monorepo — working instructions

pnpm workspace of `@cavelang/*` packages implementing the CAVE
specification; the spec itself lives in `.claude/skills/` (section index
in README.md). `make check` runs typecheck + all tests.

## Live documentation

All documentation is maintained as live documentation. Every pull request
must use [`DOCUMENTATION.md`](DOCUMENTATION.md) to review the surfaces affected
by its changes and update them in the same PR, including package READMEs,
architecture and implementation guides, specification skills, examples,
website copy, TODO status, and the book source/PDF where applicable. A PR with
stale documentation is incomplete; explicitly confirm the review when no
documentation edit is needed. Historical changelogs, changesets, completed
outcomes, authorship, and license records remain point-in-time records.

## Versioning — changesets

All `@cavelang/*` packages release together at one version (a changesets
`fixed` group; `scripts/sync-versions.mjs` syncs the private root
manifest and `tree-sitter.json` to it — the private website and VS Code
manifests deliberately stay put). **Never edit a `version` field by
hand** — versions only move in the automated release PR.

**Every change adds a changeset instead of a version bump** — package
source, docs, these instructions, or the spec skills in `.claude/skills/`.
Write a uniquely named file under `.changeset/` (unique files can't
conflict between concurrent PRs):

```md
---
"@cavelang/core": patch
---

One-line summary of the change.
```

Name any one package you touched (for spec/docs-wide changes use
`@cavelang/core`); the fixed group bumps every package together.

- patch (0.x.Y) — fixes, docs, instruction/skill wording that doesn't
  change semantics
- minor (0.X.0) — new features, new CLI surface, spec/skill additions or
  semantic changes

CI rejects PRs that add no changeset. A change without a changeset is an
incomplete change.

Releases are automated (.github/workflows/publish.yml): merged changesets
accumulate in a `chore(release): version packages` PR; merging it bumps
every version source, publishes to npm and tags `v<version>`.
