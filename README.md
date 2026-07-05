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
pnpm install       # puts the `cave` CLI on the workspace path
```

Take a note you'd write anyway — [`examples/family-history/notes.md`](examples/family-history/notes.md):

> Talked family history with Grandma Maria today. Her father Jan was born in Kraków — she says 1932, but her cousin has always insisted it was 1931. Jan's mother Helena ran a bakery on Long Street until the war. Family lore says Helena's father — my great-great-grandfather — fought in the 1920 war; Maria is only fairly sure it's true (60%, say), nobody has papers.
>
> Maria's daughter is my mum, Anna. Oh, and last spring's DNA test finally settled it: the "cousin Piotr" branch really is related — 88% match.

The same knowledge as CAVE — one atomic claim per line ([`examples/family-history/notes.cave`](examples/family-history/notes.cave)):

```cave
; Grandma Maria's 90th birthday — family history notes, caved 2026-07-04

PARENT-OF IS verb ; X is a parent of Y
PARENT-OF REVERSE CHILD-OF

helena/father PARENT-OF helena
helena PARENT-OF jan
jan PARENT-OF maria
maria PARENT-OF anna
anna PARENT-OF me

jan HAS birthplace: Kraków @src:maria
jan HAS birth-year: 1932 @src:maria @ 70%
jan HAS birth-year: 1931 @src:cousin @ 40%

helena HAS occupation: baker @loc:long-street
helena/father IS war-1920-veteran @ 60% ; family lore, no papers

piotr/branch IS related-family @src:dna-test @ 88%
```

Lint it, then load it into a SQLite store:

```
$ pnpm exec cave parse examples/family-history/notes.cave
ok: 1 comment, 6 blank, 13 claim

$ pnpm exec cave add --db family.db examples/family-history/notes.cave
added 13 claim(s), 0 edge(s)
```

**Ask for something nobody wrote down.** Every stored fact is a single hop; the ancestor chain is nowhere stated. The transitive pattern derives it:

```
$ pnpm exec cave query --db family.db '?a PARENT-OF+ me'
?a = anna
?a = helena
?a = helena/father
?a = jan
?a = maria
```

And because the file declared `PARENT-OF REVERSE CHILD-OF`, the *same stored rows* answer the opposite direction — Helena's descendants, no extra rows, one shared belief history per fact:

```
$ pnpm exec cave query --db family.db '?d CHILD-OF+ helena'
?d = anna
?d = jan
?d = maria
?d = me
```

**Ask what you actually believe.** The disputed birth year is two coexisting claims, each with its own source and confidence — and queries filter on it:

```
$ pnpm exec cave query --db family.db 'jan HAS birth-year: ?y'
?y = 1932
?y = 1931

$ pnpm exec cave query --db family.db 'jan HAS birth-year: ?y' 'WHERE conf >= 0.6'
?y = 1932
```

**Update belief by appending, never editing.** The birth certificate turns up in an archive: append the new evidence and downgrade grandma's version (context is part of a claim's identity, so the downgrade names the same `@src:`). Nothing is deleted:

```
$ echo 'jan HAS birth-year: 1931 @src:birth-certificate @ 95%' | pnpm exec cave add --db family.db
added 1 claim(s), 0 edge(s)

$ echo 'jan HAS birth-year: 1932 @src:maria @ 5% ; grandma was off by one' | pnpm exec cave add --db family.db
added 1 claim(s), 0 edge(s)

$ pnpm exec cave query --db family.db 'jan HAS birth-year: ?y' 'WHERE conf >= 0.6'
?y = 1931
```

The 70% row is still there: `cave export --db family.db` replays the full belief history as canonical text, `--current` emits just today's beliefs — and that text *is* the backup/interchange format (`cave import` restores it).

### Let an LLM write the claims — `cave ingest`

The extraction above was done by hand to show the language. `cave ingest` automates it: point it at files (globs supported) or web pages (URLs are fetched and readability-extracted) plus any headless agent — Claude Code, Copilot CLI, or your own SDK script — and the agent reads them and records claims through the engine's MCP tools:

```
$ pnpm exec cave ingest --db lore.db examples/family-history/notes.md \
    --instructions examples/family-history/instructions.md \
    --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
ingest: 1 file(s) matched, 0 skipped (unchanged), 1 batch(es)
batch 1/1 (1 file(s)): +14 claim(s)
  agent: done: 14 claims added
done: +14 claim(s)
```

The `--instructions` markdown steers domain modeling (here: "model parenthood as `PARENT-OF` relations"), and already-ingested files are skipped by content digest, so re-runs are incremental. The machine-built database answers the same transitive query:

```
$ pnpm exec cave query --db lore.db '?a PARENT-OF+ me'
?a = anna
?a = helena
?a = helena/father
?a = jan
?a = maria
```

(LLM output naturally varies run to run; the report above is one actual run. See [`@cavelang/ingest`](packages/ingest) for URL ingestion, batching, hybrid knowledge context, `--stdout` mode, and SDK drivers.)

From here: `cave mcp --db family.db` serves the store to any MCP client, and `pnpm exec cave help` lists everything. More worked examples — including a production-incident postmortem with confidence-filtered root-cause queries — live in [`examples/`](examples).

### Syntax highlighting

One tree-sitter grammar ([`packages/tree-sitter-cave`](packages/tree-sitter-cave)) drives every surface: `cave highlight` (and `cave export` on a terminal) colors CAVE text with the grammar's own `highlights.scm`, the [VSCode extension](editors/vscode) replays the same query as semantic tokens, and tree-sitter-native editors (Neovim, Helix, Zed) can point at the grammar directly.

## Development

```sh
pnpm test             # all packages, bottom-up
pnpm typecheck
pnpm exec cave demo   # cave-loop multi-hop recovery demo (§18)
```

Implementation lives in a pnpm TypeScript monorepo — see [IMPLEMENTATION.md](IMPLEMENTATION.md) for the package map (`@cavelang/core` → `parser` → `canonical` → `store` → `query` → `fusion` → `loop` → `mcp` → `ingest` → `tree-sitter-cave` → `highlight` → `cli`), toolchain, and cross-package design decisions.

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
