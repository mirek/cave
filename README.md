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

Take a note you'd write anyway — Friday's incident, say:

> At 14:05 UTC checkout latency spiked to ~4s and errors hit 12%. Checkout calls payments, payments goes through the auth gateway, and auth keeps sessions in redis-cache — which had been failing over intermittently since a 13:50 config push. The CDN was the first suspect (unlikely, maybe 30%), but the redis failover looks like the real cause (85%): rolling the config back brought latency down to ~180ms by 14:40. Billing is still investigating a few double-charges (60% it's related).

The same knowledge as CAVE — one atomic claim per line. Save it as `incident.cave`:

```cave
; Friday's checkout incident — extracted 2026-07-03

checkout USES payments
payments USES auth/gateway
auth/gateway USES redis-cache

redis-cache HAS state: intermittent-failover @time:2026-07-03T13:50Z
config-push CAUSE redis-cache/failover @ 85%

checkout HAS p99-latency: ~4s @time:2026-07-03T14:05Z
checkout HAS error-rate: 12% @time:2026-07-03T14:05Z

cdn CAUSE checkout/errors @ 30% ; first suspicion
redis-cache/failover CAUSE checkout/errors @ 85%
  BECAUSE rollback-restored-latency

rollback FIX checkout/errors
checkout HAS p99-latency: ~180ms @time:2026-07-03T14:40Z

double-charge EXISTS @support #billing @ 60% ; billing still investigating
```

Lint it, then load it into a SQLite store:

```
$ pnpm exec cave parse incident.cave
ok: 1 comment, 7 blank, 12 claim, 1 qualifier

$ pnpm exec cave add incident.cave --db incident.db
added 13 claim(s), 1 edge(s)
```

**Ask for something nobody wrote down.** No line says checkout depends on redis-cache — that fact is three hops of `USES` away. The transitive pattern derives it:

```
$ pnpm exec cave query '?svc USES+ redis-cache' --db incident.db
?svc = auth/gateway
?svc = checkout
?svc = payments
```

Every service exposed to the flaky cache — including `checkout`, which only reaches it through `payments → auth/gateway`.

**Ask what you actually believe.** Claims carry confidence, and queries filter on it — competing hypotheses coexist until evidence sorts them out:

```
$ pnpm exec cave query '?cause CAUSE checkout/errors' --db incident.db
?cause = cdn
?cause = redis-cache/failover

$ pnpm exec cave query '?cause CAUSE checkout/errors' 'WHERE conf >= 0.7' --db incident.db
?cause = redis-cache/failover
```

**Update belief by appending, never editing.** The CDN logs come back clean — append one line. The latest claim wins; the 30% row stays in history:

```
$ echo 'cdn CAUSE checkout/errors @ 5% ; ruled out, CDN logs clean' | pnpm exec cave add --db incident.db
added 1 claim(s), 0 edge(s)

$ pnpm exec cave query '?cause CAUSE checkout/errors' 'WHERE conf >= 0.2' --db incident.db
?cause = redis-cache/failover
```

**Read the same fact from either end.** `USES REVERSE USED-BY` ships in the standard prelude, so one stored row answers both directions — no second row, one shared belief history:

```
$ pnpm exec cave query 'redis-cache USED-BY ?x' --db incident.db
?x = auth/gateway
```

From here: `cave export --db incident.db` replays the full belief history as canonical text (`--current` for current beliefs only — the text *is* the backup/interchange format), `cave ingest 'notes/**/*.md' --db knowledge.db` drives an LLM agent to do the prose→claims extraction for you, and `cave mcp --db knowledge.db` serves the store to any MCP client. `pnpm exec cave help` lists everything.

## Development

```sh
pnpm test             # all packages, bottom-up
pnpm typecheck
pnpm exec cave demo   # cave-loop multi-hop recovery demo (§18)
```

Implementation lives in a pnpm TypeScript monorepo — see [IMPLEMENTATION.md](IMPLEMENTATION.md) for the package map (`@cavelang/core` → `parser` → `canonical` → `store` → `query` → `fusion` → `loop` → `mcp` → `ingest` → `cli`), toolchain, and cross-package design decisions.

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
