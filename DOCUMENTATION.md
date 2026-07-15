# CAVE documentation index

CAVE documentation is a set of **live documents**, not a historical snapshot.
Every pull request must review the documentation surfaces below and update all
affected files in the same change. A PR that changes behavior but leaves its
examples, reference text, architecture, skills, or generated book stale is
incomplete. When no text changes are needed, the PR author still confirms that
the review was performed.

Historical records are the exception: changelogs, changesets, completed TODO
outcomes, authorship, and license text describe a point in time and must not be
rewritten merely to match current behavior.

## Sources of truth

| Subject | Authoritative source | Kept aligned |
|---|---|---|
| Public behavior | implementation, types, tests, and CLI `--help` | package READMEs, root README, book, website |
| Normative CAVE language and semantics | `.claude/skills/cave-*/SKILL.md` | parser/canonical docs, book, examples |
| System boundaries and runtime flows | `ARCHITECTURE.md` plus package dependency graph | `IMPLEMENTATION.md`, book architecture chapter, website docs |
| Package API | exported types and package tests | `packages/*/README.md` |
| CLI and MCP surfaces | command/tool registries and their help output | CLI/MCP READMEs, root README, book field guide |
| Project version | root `package.json` and release automation | website and book read it dynamically; do not copy a current version literal |
| Work status | implementation and merged changes | `TODO.md`, `todo/**/*.md`, `BUGS.md` |

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
| System design | `ARCHITECTURE.md`, `IMPLEMENTATION.md` | Boundaries, flows, package map, toolchain, and implementation decisions. |
| Contributor instructions | `CLAUDE.md`, `.github/pull_request_template.md` | Required repository and PR workflow. |
| Normative specification skills | `.claude/skills/cave-design/SKILL.md`, `.claude/skills/cave-writing/SKILL.md`, `.claude/skills/cave-extraction/SKILL.md`, `.claude/skills/cave-storage-query/SKILL.md` | Numbered CAVE specification sections. |
| Supporting skills | `.claude/skills/typst/SKILL.md`, `.claude/skills/verify/SKILL.md` | Book production and end-to-end verification guidance. |
| Book source | `book/README.md`, `book/cave.typ`, `book/style.typ`, `book/parts/*.typ` | Continuous system guide and its build instructions. |
| Book artifact | `website/public/cave-book.pdf` | Generated PDF; must change with its Typst source. |
| Package reference | `packages/*/README.md`, `packages/solver-z3/BENCHMARK.md` | Public package contracts, examples, and solver measurements. |
| Package history | `packages/*/CHANGELOG.md` | Generated historical release record. |
| Website | `website/README.md`, `website/src/content.ts`, `website/src/pages/Home.tsx`, `website/src/App.tsx` | Site instructions and user-facing documentation/navigation copy. Most docs pages import repository Markdown directly. |
| Editor | `editors/vscode/README.md` | VS Code extension usage and development. |
| Examples | `examples/**/*.md` | Runnable fixture explanations and agent/extraction instructions. |
| Backlog and defects | `TODO.md`, `todo/**/*.md`, `BUGS.md` | Current work, completed outcomes, permanent references, and known bugs. |
| Project/legal | `Authors.md`, `License.md`, `editors/vscode/License.md`, `packages/*/License.md` | Authorship and license records. |
| Release metadata | `.changeset/README.md`, `.changeset/*.md` | Changeset instructions and immutable pending release notes. |

Configuration and source comments may also be user-facing documentation. In
particular, keep command usage strings in `packages/*/src/main.ts` and
`packages/cli/src/cli.ts`, package descriptions in `package.json` files, and
workflow comments aligned when their behavior changes.

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
| A TODO or bug becomes implemented | its status and outcome, plus `TODO.md`/`BUGS.md` index |
| A version is released | version automation only; derived website/book displays update automatically |

## Pull request freshness check

Before publishing a PR:

1. Search this index for every changed subsystem.
2. Compare examples and claims with exported types, tests, and real `--help`
   output rather than memory.
3. Update every affected live document in the PR; update a TODO's status and
   outcome when the work completed it.
4. Rebuild generated documentation artifacts from their checked-in sources.
5. Check links, code examples, current-version displays, and documentation
   navigation.
6. Record the review in the pull request checklist, including “no documentation
   change required” when that is the verified result.
