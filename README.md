# CAVE — Compressed Atomic Verb Expressions

A small, line-oriented language for persisting knowledge as composable, atomic claims. Easy for humans and LLMs to write, easy to diff, stored in SQLite, formal enough to query as an information graph.

The core idea:

```cave
subject VERB object
```

Everything else is optional metadata on that claim:

```cave
auth/middleware HAS bug: token-expiry #security
`<=` FIX token-expiry @auth.ts:42
server IS NOT compromised @ 90%
OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr @2026-Q1 @ 90%
server CAUSE crash @ 80%
  WHEN load > ~1000 req/s
```

Properties: **atomic** (one claim per line), **append-only** (belief evolves by appending, never mutating — history is preserved), **queryable** (CAVE-Q patterns or plain SQL), and **inverse-aware** (`CONTAINS REVERSE PART-OF` makes one stored fact readable from both ends).

## Quick start

```sh
pnpm install
pnpm test          # all packages, bottom-up
pnpm typecheck
pnpm --filter @cave/loop demo
```

Implementation lives in a pnpm TypeScript monorepo — see [IMPLEMENTATION.md](IMPLEMENTATION.md) for the package map (`@cave/core` → `parser` → `canonical` → `store` → `query` → `fusion` → `loop` → `mcp` → `ingest` → `cli`), toolchain, and cross-package design decisions.

## The specification

The full spec is split across four Claude Code skills in [`.claude/skills/`](.claude/skills). Spec section numbers (§) are preserved there, so section references throughout the package READMEs resolve as follows:

| Skill | Sections | Covers |
|---|---|---|
| [`cave-writing`](.claude/skills/cave-writing/SKILL.md) | §3–§8, §11, §16, §22 | Syntax, lexical rules, verbs & `REVERSE`, metadata, values/units/uncertainty, indentation & continuation, tags & topics, grammar, spec card |
| [`cave-extraction`](.claude/skills/cave-extraction/SKILL.md) | §14–§15, §21 | Converting text to CAVE, granularity, operating modes, worked example |
| [`cave-storage-query`](.claude/skills/cave-storage-query/SKILL.md) | §9, §12–§13 | Append-only belief evolution, claim keys, CAVE-Q, SQLite schema, canonicalization |
| [`cave-design`](.claude/skills/cave-design/SKILL.md) | §0–§2, §10, §17–§19 | Status conventions, design goals, claim model, probabilistic layer, Draft unified grammar, agent layer, rationale |

Sections are **Normative** unless marked Legacy, Draft, or Non-normative (§0). The status of the implementation against the spec is tracked in [IMPLEMENTATION.md](IMPLEMENTATION.md#status-vs-the-spec).

## Cheat sheet (§22)

```cave
subject VERB [NOT] object                [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
subject HAS attribute: value [+/- delta [(Nσ)]] [@context...] [#tag[:value]...] [@ N%] [!] [; comment]

VERB REVERSE INVERSE-VERB                ; declare inverse; left side is primary
  parent VERB object
    VERB object2                         ; continuation: inherits parent subject
    INVERSE-VERB other                   ; continuation: parent lands in object position
    WHEN condition                       ; qualifier edge on the parent claim
```

Disambiguation: `@` + space = confidence, `@` + no space = context; `#` begins a tag, first `:` inside it splits key/value; `:` in payload binds attribute to value; `/` after a number is "per", elsewhere entity scope.
