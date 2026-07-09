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

### Rules derive what nobody wrote — `cave derive`

The transitive query above *asks* for the ancestor chain; a rule can
*conclude* new claims and record them, with lineage. Rules are one-line
`premises => conclusion` implications (spec §24) whose premises are
ordinary CAVE-Q patterns — [`examples/family-history/rules.cave`](examples/family-history/rules.cave):

```cave
GRANDPARENT-OF IS verb ; X is a grandparent of Y
GRANDPARENT-OF REVERSE GRANDCHILD-OF

?a PARENT-OF ?b, ?b PARENT-OF ?c => ?a GRANDPARENT-OF ?c ; two parent hops
```

```
$ pnpm exec cave derive --db family.db examples/family-history/rules.cave
declared 1 rule(s), +2 prelude claim(s)
rule/ecf351a4f3e7: 4 solution(s), +4 appended, 0 updated, 0 retracted, 0 unchanged ; two parent hops
derived: +4 appended, 0 updated, 0 retracted, 0 unchanged (2 pass(es))

$ pnpm exec cave query --db family.db 'me GRANDCHILD-OF ?g'
?g = maria
```

Every derived claim records *why it is believed* — `BECAUSE` edges to the
exact premise rows and a `VIA` edge to the rule, visible in the export:

```cave
jan GRANDPARENT-OF anna @src:rule/ecf351a4f3e7
  BECAUSE jan PARENT-OF maria @src:cli
  BECAUSE maria PARENT-OF anna @src:cli
  VIA rule/ecf351a4f3e7 HAS rule: `?a PARENT-OF ?b, ?b PARENT-OF ?c => ?a GRANDPARENT-OF ?c` @src:cave-derive
```

Confidence composes (premises at 80% and 90% conclude at 72%, noisy-AND),
re-runs are idempotent and skip rules nothing new could affect, and when a
premise is later retracted the conclusions it supported are retracted with
it — `cave derive` again to propagate. See [`@cavelang/rules`](packages/rules).

### Decisions execute as governed writes — `cave act`

Rules conclude on their own; **actions** put the write in the caller's
hands, governed (spec §25). An action is the same one-line shape with
parameters — bare `?name` segments the caller supplies — declared in-band
under a stable name:

```cave
action/record-birth HAS action: `?parent, ?child, ?parent EXISTS => ?parent PARENT-OF ?child` ; record a birth in the family tree
```

```
$ pnpm exec cave act --db family.db record-birth parent=anna child=little-jan
executed action/record-birth: +1 appended, 0 updated, 0 unchanged (1 solution(s))
  appended: anna PARENT-OF little-jan
```

Executing validates the parameters, checks every precondition against
current belief (no match → nothing is appended), then appends the effects
atomically — stamped `@src:action/<name>`, linked `BECAUSE` to the
precondition rows and `VIA` to the declaration, idempotent on re-run, and
gated on the store's `EXPECTS` shapes by default (§20.3's mechanism at its
second enforcement point). `cave mcp` serves every declared action as a
generated `act_<name>` tool, so agents get a governed write vocabulary
instead of freeform appends — and a declared hook name
(`HAS hook: notify`) can fire an out-of-band, config-declared shell
template after commit, carrying the decision to the outside world
(the claim names the hook; the command never lives in the store). See
[`@cavelang/act`](packages/act).

### Structured data needs no LLM — `cave connect`

CSV/JSON/SQLite records deserve exact, repeatable, token-free conversion. `cave connect` maps them through an ordinary CAVE document whose `?field` variables stand for record fields — same input, same claims, every time:

```
$ pnpm exec cave connect people.csv --map people.map.cave --db k.db --key id
connect: 2 record(s): 2 mapped, 0 skipped (unchanged); +10 claim(s)
```

Re-runs skip unchanged rows by per-record digest, changed rows retract the claims they no longer yield, `--watch` tails a file continuously, and `--query '?who WORKS-AT acme'` answers a CAVE-Q pattern over the union of store and source without persisting anything. See [`@cavelang/connect`](packages/connect) and spec §23.

### Extraction quality is a number — `cave eval`

Is a new ingestion prompt, model or instruction set better or worse? `cave eval` makes that falsifiable: fixtures are plain files — a source, its expected extraction (`.golden.cave`), and optional CAVE-Q expectations the built store must answer — and any agent runs against them N times in fresh throwaway stores. Here the "agent" is a `sed` that renames `maria`, simulating the naming drift real extractions suffer:

```
$ pnpm exec cave eval examples/eval --stdout \
    --agent 'sed "s/maria/grandma-maria/g" family-history.golden.cave'
eval: 1 case(s), 1 run(s) each
examples/eval/family-history: 13 golden claim(s), 5 query(ies), source family-history.md
  run 1/1: 13 claim(s) — 9 matched; P 69% R 69% F1 69%; queries 3/5
    miss: maria PARENT-OF anna
    extra: grandma-maria PARENT-OF anna
    ...
    query failed: ?a PARENT-OF+ me
      missing ?a = maria
      unexpected ?a = grandma-maria
suite: P 69% R 69% F1 69%; queries 60%
```

Scoring is by claim key (actor stamps ignored, spec §9.5; inverse-direction writes match for free) plus value tolerance; misses, extras and failed query bindings are diagnosed per run, an optional `--judge` agent pairs naming drift into a parallel judged F1, and `--min 90%` turns the suite into a CI gate. Point a real agent at it the same way as `cave ingest` — `--agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"' --runs 3`. See [`@cavelang/eval`](packages/eval).

From here: `cave mcp --db family.db` serves the store to any MCP client, and `pnpm exec cave help` lists everything. More worked examples — including a production-incident postmortem with confidence-filtered root-cause queries — live in [`examples/`](examples).

### Syntax highlighting

One tree-sitter grammar ([`packages/tree-sitter-cave`](packages/tree-sitter-cave)) drives every surface: `cave highlight` (and `cave export` on a terminal) colors CAVE text with the grammar's own `highlights.scm`, the [VSCode extension](editors/vscode) replays the same query as semantic tokens, and tree-sitter-native editors (Neovim, Helix, Zed) can point at the grammar directly.

## Where CAVE is heading

[ROADMAP.md](ROADMAP.md) maps CAVE's path to a complete knowledge loop on one machine — sense, model, conclude, act, trust, distribute: what exists, what's missing (resolution policy, automation, sync), the phased plan, and the open design decisions along the way.

## Development

```sh
pnpm test             # all packages, bottom-up
pnpm typecheck
pnpm exec cave demo   # cave-loop multi-hop recovery demo (§18)
```

Implementation lives in a pnpm TypeScript monorepo — see [IMPLEMENTATION.md](IMPLEMENTATION.md) for the package map (`@cavelang/core` → `parser` → `canonical` → `store` → `query` → `shape` → `connect` → `fusion` → `rules` → `act` → `loop` → `mcp` → `ingest` → `eval` → `tree-sitter-cave` → `highlight` → `cli`), toolchain, and cross-package design decisions.

## The specification

The full spec is split across four Claude Code skills in [`.claude/skills/`](.claude/skills). Spec section numbers (§) are preserved there, so section references throughout the package READMEs resolve as follows:

| Skill | Sections | Covers |
|---|---|---|
| [`cave-writing`](.claude/skills/cave-writing/SKILL.md) | §3–§8, §11, §16, §22 | Syntax, lexical rules, verbs & `REVERSE`, metadata, values/units/uncertainty, indentation & continuation, tags & topics, grammar, spec card |
| [`cave-extraction`](.claude/skills/cave-extraction/SKILL.md) | §14–§15, §21, §23 | Converting text to CAVE, granularity, operating modes, worked example, deterministic structured ingestion (`cave connect`) |
| [`cave-storage-query`](.claude/skills/cave-storage-query/SKILL.md) | §9, §12–§13, §20, §24–§25 | Append-only belief evolution, claim keys, CAVE-Q, SQLite schema, canonicalization, shape expectations & knowledge health, rules & derivation, actions & governed writes |
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
