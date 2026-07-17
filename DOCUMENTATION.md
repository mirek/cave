# CAVE documentation index

CAVE documentation is a set of **live documents**, not a historical snapshot.
Every pull request must review the documentation surfaces below and update all
affected files in the same change. A PR that changes behavior but leaves its
examples, reference text, architecture, skills, or generated book stale is
incomplete. When no text changes are needed, the PR author still confirms that
the review was performed.

Historical records are the exception: changelogs, changesets, durable decision
records, authorship, and license text describe a point in time and must not be
rewritten merely to match current behavior. A completed TODO is not a
historical record: delete its backlog file and index entry, moving any lasting
rationale into the relevant live document or changelog.

## Sources of truth

| Subject | Authoritative source | Kept aligned |
|---|---|---|
| Public behavior | implementation, types, tests, and CLI `--help` | package READMEs, root README, book, website |
| Normative CAVE language and semantics | `.claude/skills/cave-*/SKILL.md` | parser/canonical docs, book, examples; the root specification index is registry-checked |
| System boundaries and runtime flows | `ARCHITECTURE.md` plus package dependency graph | `IMPLEMENTATION.md`, book architecture chapter, website docs |
| Package API | implementation exports, package-manifest `exports`, and `package-surfaces.json` | `packages/*/README.md`, `PACKAGE_SURFACES.md`, root overview, and website navigation; registry projections are checked in tests |
| CLI and MCP surfaces | `packages/cli/src/commands.ts`, `packages/mcp/src/tools.ts`, and their help output | CLI/MCP READMEs, root README, book field guide; `packages/cli/test/documentation.test.ts` validates the package reference tables |
| Project version | root `package.json` and release automation | website and book must read it dynamically; the import paths are checked in tests and must not become copied literals |
| Work status | implementation and merged changes | `TODO.md`, `todo/**/*.md`, `BUGS.md`, `bugs/**/*.md` |

If two documents disagree, fix the lower-authority projection rather than
preserving both descriptions. Normative skills still change deliberately: an
implementation difference may instead reveal a bug or an intentionally staged
spec change.

## Complete index

The paths and globs in this table cover every maintained documentation surface
in the repository.

| Surface | Files | Purpose |
|---|---|---|
| Entry points | `README.md`, `DOCUMENTATION.md` | User overview, specification index, and this maintenance map. |
| Project references | `PROJECT-BOUNDARIES.md`, `RETIRED-ROADMAP.md` | Permanent non-goals and historical roadmap resolution outside the active backlog. |
| System design | `ARCHITECTURE.md`, `IMPLEMENTATION.md` | Boundaries, flows, package map, toolchain, and implementation decisions. |
| Contributor instructions | `CLAUDE.md`, `.github/pull_request_template.md` | Required repository and PR workflow. |
| Normative specification skills | `.claude/skills/cave-design/SKILL.md`, `.claude/skills/cave-writing/SKILL.md`, `.claude/skills/cave-extraction/SKILL.md`, `.claude/skills/cave-storage-query/SKILL.md` | Numbered CAVE specification sections. |
| Supporting skills | `.claude/skills/typst/SKILL.md`, `.claude/skills/verify/SKILL.md` | Book production and end-to-end verification guidance. |
| Book source | `book/README.md`, `book/cave.typ`, `book/style.typ`, `book/parts/*.typ` | Continuous system guide and its build instructions. |
| Book artifact | `website/public/cave-book.pdf` | Generated PDF; must change with its Typst source. |
| Package reference | `packages/*/README.md`, `packages/solver/MINIZINC-EVALUATION.md`, `packages/solver/HIGHS-EVALUATION.md`, `packages/solver-z3/BENCHMARK.md` | Public package contracts, examples, solver measurements, and backend decisions. |
| Package history | `packages/*/CHANGELOG.md` | Generated historical release record. |
| Website | `website/README.md`, `website/src/content.ts`, `website/src/pages/Home.tsx`, `website/src/App.tsx` | Site instructions and user-facing documentation/navigation copy. Most docs pages import repository Markdown directly. |
| Editor | `editors/vscode/README.md` | VS Code extension usage and development. |
| Examples | `examples/**/*.md` | Runnable fixture explanations and agent/extraction instructions. |
| Backlog and defects | `TODO.md`, `todo/**/*.md`, `BUGS.md`, `bugs/**/*.md` | Remaining work and known bugs. Completed TODOs and fixed bugs are removed. |
| Project/legal | `Authors.md`, `License.md`, `editors/vscode/License.md`, `packages/*/License.md` | Authorship and license records. |
| Release metadata | `.changeset/README.md`, `.changeset/*.md` | Changeset instructions and immutable pending release notes. |

Configuration and source comments may also be user-facing documentation. In
particular, keep command usage strings in `packages/*/src/main.ts` and
`packages/cli/src/cli.ts`, package descriptions in `package.json` files, and
workflow comments aligned when their behavior changes.

## Automated projection checks

`packages/cli/test/documentation.test.ts` keeps the mechanical copies small
and reviewable. It checks command and MCP tables against their registries,
every published package entry point against its package README, package
migrations against `package-surfaces.json`, website navigation against package
READMEs, the root specification index against `.claude/skills/cave-*`, and the
book/website version imports against the root manifest. Contributors update
the authoritative registry and its human explanation in one PR; ordinary
`pnpm test` reports the exact stale projection.

## Change map

| A PR changes | Review at minimum |
|---|---|
| Syntax, values, claim semantics, or canonical output | normative skills, root README, core/parser/canonical READMEs, book, examples |
| Storage, query, temporal, provenance, rules, actions, or automation | storage-query skill, relevant package READMEs, architecture, implementation guide, book |
| A package export or dependency boundary | package README, `IMPLEMENTATION.md`, `ARCHITECTURE.md`, website documentation navigation |
| A CLI command, flag, or output | CLI help, CLI README, root walkthroughs, book field guide, website copy |
| An MCP tool, scope, or security rule | MCP help/README, storage-query skill when normative, architecture, book |
| Website or playground behavior | website README and user-facing source copy; imported Markdown remains authoritative |
| Book content | Typst source, checked-in PDF, book README when the build contract changes |
| A TODO becomes implemented | delete its backlog file and index entry; preserve lasting rationale in the relevant live document or changelog |
| A bug becomes fixed | delete its bug file and `BUGS.md` index entry; keep the regression test as the durable record |
| A version is released | version automation only; derived website/book displays update automatically |

## Pull request freshness check

Before publishing a PR:

1. Search this index for every changed subsystem.
2. Compare examples and claims with exported types, tests, and real `--help`
   output rather than memory.
3. Update every affected live document in the PR; delete completed TODO files
   and their index entries rather than marking them completed; likewise delete
   fixed bug files and their index entries.
4. Rebuild generated documentation artifacts from their checked-in sources.
5. Check links, code examples, current-version displays, and documentation
   navigation.
6. Record the review in the pull request checklist, including “no documentation
   change required” when that is the verified result.
