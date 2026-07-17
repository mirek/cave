# CAVE monorepo — working instructions

pnpm workspace of `@cavelang/*` packages implementing the CAVE
specification; the spec itself lives in `.claude/skills/` (section index
in README.md). `make check` runs typecheck + all tests.

## Live documentation

All documentation is maintained as live documentation. Every pull request
must use [`DOCUMENTATION.md`](DOCUMENTATION.md) to review the surfaces affected
by its changes and update them in the same PR, including package READMEs,
architecture and implementation guides, specification skills, examples,
website copy, the remaining TODO index, and the book source/PDF where
applicable. Delete completed TODO files and fixed bug files together with their
index entries instead of marking them completed; preserve lasting rationale in
the relevant live document or changelog. A PR with stale documentation is
incomplete; explicitly confirm the review when no documentation edit is needed.
Historical changelogs, changesets, durable decision records, authorship, and
license records remain point-in-time records.

## Versioning — changesets

All `@cavelang/*` packages release together at one version (a changesets
`fixed` group; `scripts/sync-versions.mjs` syncs the private root
manifest, VS Code extension manifest, and `tree-sitter.json` to it — the
private website manifest deliberately stays put). **Never edit a `version`
field by hand** — versions only move in the automated release PR. The VS Code
extension is not in the npm fixed group; it receives the resulting version
only after Changesets finishes, then publishes separately from an existing
`v<version>` tag through `.github/workflows/vscode.yml`.

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
every version source, publishes to npm and tags `v<version>`. The publish
workflow runs `release-validate.mjs --mode=version-pr` while changesets are
pending: this validates Changesets configuration, fixed-group membership,
changeset structure, and workspace dependency ranges while allowing the
version PR to repair manifest drift. Once the version PR consumes the pending
changesets, `--mode=publish` requires exact package, derived-manifest,
changelog, version-commit, and tag coherence before npm authentication or
builds. Rerun an interrupted release at that exact version commit;
already-published packages are skipped and a missing tag is repaired only
after the build, tests, and packed-artifact smoke test.

A brand-new public package must exist on npm before its trusted publisher can
be configured. Bootstrap it from the exact version commit with `make publish`,
then configure `.github/workflows/publish.yml` as its npm trusted publisher and
rerun that commit's Publish workflow. Do not substitute `npm publish` for the
repository command: pnpm materializes each package's production `exports` and
`bin` fields from `publishConfig`, while direct npm publication ignores those
manifest overrides.
