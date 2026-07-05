# CAVE monorepo — working instructions

pnpm workspace of `@cavelang/*` packages implementing the CAVE
specification; the spec itself lives in `.claude/skills/` (section index
in README.md). `make check` runs typecheck + all tests.

## Versioning

All packages (root `package.json` and every `packages/*/package.json`)
share one version, bumped in lockstep — never bump a single package alone.

**Always bump the version as part of any change** — package source, docs,
these instructions, or the spec skills in `.claude/skills/`:

- patch (0.x.Y) — fixes, docs, instruction/skill wording that doesn't
  change semantics
- minor (0.X.0) — new features, new CLI surface, spec/skill additions or
  semantic changes

A change without a version bump is an incomplete change.
