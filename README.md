# CAVE — Compressed Atomic Verb Expressions

A small, line-oriented language for persisting knowledge as composable, atomic claims. Easy for humans and LLMs to write, easy to diff, stored in SQLite, formal enough to query as an information graph.

For the package boundaries, runtime flows, storage model, and architectural
invariants, see [ARCHITECTURE.md](ARCHITECTURE.md).

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

That permanence includes mistakes and sensitive text. Retraction and
`--current` queries change what is believed; they do not erase earlier rows,
`raw_line`, metadata, exact exports, synced copies, or backups. CAVE deliberately
has no claim-level redact/forget command because it cannot guarantee erasure
across SQLite remnants, FTS, peers, snapshots, and storage devices. Do not
ingest credentials or data requiring selective deletion. After accidental
secret ingestion, rotate the secret, stop sync, inventory every copy, rebuild
from reviewed safe input, verify the replacement, and explicitly destroy or
expire all affected databases, exports, backups, and snapshots (spec §9.6).

**Or let the store pick a winner.** The three sources still coexist — one fact, three voices. `cave resolve` shows the contest as the resolution policy (spec §26) ranks it — precedence class, reliability-weighted confidence, then recency — and `--resolve` on any query matches only the winners:

```
$ pnpm exec cave resolve --db family.db
jan HAS birth-year: 1931 @src:birth-certificate @ 95% ; class 2, effective 95%
  over jan HAS birth-year: 1931 @src:cousin @ 40% ; class 2, effective 40%
  over jan HAS birth-year: 1932 @src:maria @ 5% ; grandma was off by one ; class 2, effective 5%

$ pnpm exec cave query --db family.db 'jan HAS birth-year: ?y' --resolve
?y = 1931
```

The policy is itself knowledge — `source/maria HAS reliability: 60%` discounts a source in-band — and a built-in precedence ladder makes a human correction (`@src:cli`) outrank a machine ingest re-run, whatever landed last.

Under the compact context syntax, the store keeps actor, physical source,
lifecycle run, and domain as separate indexed provenance dimensions. This
lets a source citation such as `@src:inventory` coexist with engine ownership:
connect, rules, actions, and automations retract or ignore their own output by
the run dimension, not by trusting an authored context string. Existing CAVE
text, claim keys, context filters, exports, and old databases remain compatible
(spec §9.5.1).

The 70% row is still there: `cave export --db family.db` replays the belief
history allowed by its sensitivity ceiling as canonical text, and `--current`
emits just today's allowed beliefs. Claims may be labelled
`#sensitivity:public`, `internal`, `confidential`, or `restricted`; unlabeled
claims and publication surfaces default to `internal`, while malformed labels
fail closed as `restricted`. Use `--max-sensitivity restricted` only when an
exact backup or replica is intended. This text *is* the backup/interchange
format (`cave import` restores it), but neither `--current` nor sensitivity
filtering erases permanent history (§9.6–§9.7).

**Time is an axis of the world, not just of the store.** Transaction time — when the store learned something — is reconstructable with `--as-of`. Claims can also say *when in the world* they hold (spec §32): a date-like context scopes a claim to a period or range, and a trajectory value (`A -> B`) interpolates linearly across its range:

```
$ printf '%s\n' 'jan WORKS-AT textile-mill @1950..1974' \
    'jan WORKS-AT railways @1975..' \
    'mill/wage IS 200 -> 900 PLN/mo @1950..1974' | pnpm exec cave add --db family.db
added 3 claim(s), 0 edge(s)

$ pnpm exec cave query --db family.db 'jan WORKS-AT ?where' --at 1960
?where = textile-mill

$ pnpm exec cave query --db family.db 'mill/wage IS' --at 1962
mill/wage IS 200 -> 900 PLN/mo @1950..1974 ; at 1962: 550 PLN/mo
```

Timeless claims (most knowledge) always match; time-scoped claims filter by coverage; trajectories evaluate at the instant. And because `--at` (valid time) composes with `--as-of` (belief time), "what did we believe last year about 1962?" is one query — bitemporal questions fall out of two orthogonal flags. See spec §32.

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

The `--instructions` markdown steers domain modeling (here: "model parenthood as `PARENT-OF` relations"), and already-ingested files are skipped by content digest, so re-runs are incremental. Embedded source text is line-numbered for the extractor: claims can point back to the exact sentence with `@src:notes.md#L10-L12` (reserved characters in the source are percent-escaped, spec §9.8). The machine-built database answers the same transitive query:

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
action/record-birth HAS action: `?parent, ?child, ?parent PARENT-OF me => ?parent PARENT-OF ?child` ; record a birth in the family tree
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

Re-runs skip unchanged rows by per-record digest, changed rows retract the claims they no longer yield, `--watch` tails a file continuously, and `--query '?who WORKS-AT acme'` answers a CAVE-Q pattern over the union of store and source without persisting anything. Every mapped row keeps its physical source identity; CSV/TSV and JSONL claims also carry exact source line ranges alongside the stable record lifecycle stamp. See [`@cavelang/connect`](packages/connect) and spec §9.8, §23.

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

### Naming drift is discoverable — `cave suggest-alias`

The eval above *measures* drift; in a live store you want it *found*. Suppose later notes recorded claims about `grandma-maria` and a new baby, `little-jan`, into the family database. Discovery proposes same-entity candidates (spec §27):

```
$ pnpm exec cave suggest-alias --db family.db
grandma-maria ALIAS maria #suggested @ 35% ; segments of maria within grandma-maria
little-jan ALIAS jan #suggested @ 35% ; segments of jan within little-jan
```

One is right, one is wrong — little-jan is named *after* his great-grandfather. Suggestions are questions, not merges: 30–50% confidence puts them in `cave check`'s review band, and both review moves are ordinary appends. A pair with any recorded `ALIAS` history — merged, rejected or unmerged — is never suggested again, so the decision sticks and the confirmed link immediately powers alias-closure reads:

```
$ printf 'grandma-maria ALIAS maria ; confirmed\nlittle-jan ALIAS NOT jan ; named after him\n' \
    | pnpm exec cave add --db family.db
added 2 claim(s), 0 edge(s)

$ pnpm exec cave suggest-alias --db family.db
no alias suggestions

$ pnpm exec cave query --db family.db '?d CHILD-OF+ grandma-maria' --aliases
?d = anna
?d = little-jan
?d = me
```

Candidates are scored by explainable signals — case/separator drift, segment containment, prefixes, typos, shared rare attribute values, with shared relations as a booster; the evidence rides in the comment. An optional `--agent 'claude -p'` judge filters candidates against each side's claims before anyone sees them, and `--write` appends the suggestions (stamped `@src:suggest/alias`) instead of printing. See [`@cavelang/shape`](packages/shape).

### Memory is reconstructed, not retrieved — `cave reconstruct`

Querying answers the question you know to ask; reconstruction pulls in everything *related* — starting from a symptom, walking forward and inverse edges best-first, collecting claims as it goes (spec §18):

```
$ pnpm exec cave reconstruct --db incident.db checkout/errors --trace
; 1. checkout/errors @ 1.00 +3 claim(s)
; 2. rollback @ 0.80 +0 claim(s)
; 3. redis-cache/failover @ 0.68 +1 claim(s)
; 4. config-push @ 0.46 +0 claim(s)
; 5. cdn @ 0.24 +0 claim(s)
cdn CAUSE checkout/errors @src:cli @ 30% ; first suspicion
redis-cache/failover CAUSE checkout/errors @src:cli @ 85%
rollback FIX checkout/errors @src:cli
config-push CAUSE redis-cache/failover @src:cli @ 85%
```

By default a deterministic heuristic picks each expansion. With `--agent 'claude -p' --query 'what caused the checkout errors?'` an LLM makes the select/stop decision instead — one prompt per step showing the claims collected so far and the scored frontier (spec §18). The heuristic is the *baseline*: reconstruction eval fixtures (`<stem>.loop.cave`, see [`examples/loop-eval`](examples/loop-eval)) score both policies with the same claim-key F1, so "does the model beat the heuristic" is two `cave eval` runs. See [`@cavelang/loop`](packages/loop).

### Two stores become one — `cave sync`

Knowledge accumulates on more than one machine. The data model pre-solved the merge: rows are immutable appends under global UUIDv7 identity, contradictions legally coexist (spec §9.4) and resolve at read time (§26) — so `cave sync` merges by row identity, and can never conflict (spec §28):

```
$ pnpm exec cave sync --db main.db laptop.db
merged 42 claim(s), 17 edge(s)
record: store/laptop SYNCED-INTO store/main ; +42 claim(s), +17 edge(s)

$ pnpm exec cave sync --db main.db laptop.db
merged 0 claim(s), 0 edge(s), 42 already present
```

Present rows skip, re-runs merge nothing, two stores syncing each other converge — and the merge itself is a claim (stamped `@src:sync`) whose belief series is the sync log. Local appends after a merge always outsort merged history, whatever the origin machine's clock read (the §28.2 receive rule). Plain text crosses air gaps the same way: `cave export --tx` precedes every claim line with a `;@` transaction annotation — an ordinary comment to every other reader — and `cave sync` replays it under the recorded identity:

```
$ pnpm exec cave export --db laptop.db --tx --max-sensitivity restricted | cave sync --db main.db - --as laptop
```

And because the annotated export is a complete replica, **the store can
live under git** (spec §28.6): commit the `--tx` export, rebuild a
working store from it on any checkout (`cave sync --db work.db
knowledge.cave --no-record`), and a pull request's diff *is* the
appended claims — reviewable line by line. Text-level conflicts
dissolve by re-exporting the union (a one-stanza git merge driver, see
[`@cavelang/sync`](packages/sync)); knowledge-level conflicts don't
exist. Landing an approved branch is one more `cave sync`.

See [`@cavelang/sync`](packages/sync) and spec §28.

### The store reacts — `cave automate`

Everything so far waits to be invoked. Automations close the loop (spec §29): an in-band declaration pairs a trigger pattern with steps, and new claims matching the trigger fire them — a governed action, an out-of-band hook, or an agent prompt whose CAVE reply is recorded:

```cave
automation/page-on-spike HAS automation: `?svc IS service, ?svc HAS error-rate: ?r, ?r > 0.05 => action/open-incident, hook/page, "investigate the spike on ?svc"` ; page and investigate error-rate spikes
```

```
$ pnpm exec cave automate --db ops.db --hooks hooks.json --agent 'claude -p'
watching (poll every 2s, ctrl-c to stop)
automation/page-on-spike: fired 1 solution(s) ; page and investigate error-rate spikes
  ?svc = checkout  ?r = 0.09
    action/open-incident: ok (+1 appended, 0 updated, 0 unchanged)
    hook/page: ok
    "investigate the spike on ?svc": ok (+2 claim(s))
settled: 1 firing(s) over 2 pass(es); derived +1 appended, 0 updated, 0 retracted
```

An automation is armed the moment it is declared — earlier rows are state, not events — and never wakes itself; rules (`cave derive`) fire incrementally in every cycle, so derived conclusions trigger automations and one automation's action effects trigger the next. Chains converge because every write path is idempotent, and firing records an in-band watermark *before* any step runs, so a re-run never re-notifies the world. `--once` makes it a cron job; with `cave connect --watch` feeding the other end, sense → model → conclude → act → record runs unattended on one machine. See [`@cavelang/automate`](packages/automate) and spec §29.

### Look at it — `cave serve`

Everything above serves programs. `cave serve` is for the person (spec §30): one static, self-contained HTML page over the store — no build step, no framework, no external resource, offline-friendly, and strictly read-only (GET only, localhost by default):

```
$ pnpm exec cave serve --db family.db
serving family.db at http://127.0.0.1:2283/ (sensitivity <= internal, read-only, ctrl-c to stop)
```

The dashboard renders the spec §20 health report — coverage tiles, then the frontier: shape violations, review candidates, stale beliefs, alias disagreements. Every entity links to its 360 (types, facts, both relation directions with declared inverses annotated, topics, the alias closure on a toggle, raw activity underneath); every claim links to its belief history — the append-only series as a timeline with confidence bars — and, where lineage edges exist, to the `BECAUSE`/`VIA` tree answering *why is this believed* and *what depends on it*. Full-text search, counts, aliases, history and lineage all obey the same sensitivity ceiling; raise it explicitly with `--max-sensitivity`. Every request reads the live store, so a running `cave automate` loop's visible appends show on the next refresh. See [`@cavelang/view`](packages/view) and spec §9.7, §30.

Applications can derive a typed boundary without replacing CAVE text or CAVE-Q:
`cave generate --db family.db --out cave-client.ts` turns current `EXPECTS`
claims into deterministic TypeScript interfaces and inverse-aware store
readers. The generated module embeds format version 1, its normalized schema,
and a SHA-256; ambiguous expectations fail rather than weakening types (spec
§20.4).

### Ship a document that cites its claims — `cave report`

Query output is for you; a *deliverable* is for someone else — and it should say where every fact came from. `cave report` renders a markdown template against the store (spec §31): fenced `cave-q` blocks repeat a fragment per solution, inline `` `cave-q: …` `` splices drop a single value into prose, and every rendered fact carries a footnote citing the claim behind it — canonical line, date, claim key:

````markdown
Jan was born in `cave-q: jan HAS birth-year: ?y` in `cave-q: jan HAS birthplace: ?where`.

## The ancestor line

```cave-q
?a PARENT-OF+ me
- ?a is an ancestor
```
````

```
$ pnpm exec cave report --db family.db brief.md --resolve --max-sensitivity internal
Jan was born in 1931[^c1] in Kraków[^c2].

## The ancestor line

- anna is an ancestor
- helena is an ancestor
- helena/father is an ancestor
- jan is an ancestor
- maria is an ancestor

[^c1]: `jan HAS birth-year: 1931 @src:birth-certificate @ 95%` — 2026-07-10, claim key `["e:jan","HAS",0,"a:birth-year",["src:birth-certificate"]]`
[^c2]: `jan HAS birthplace: Kraków @src:maria` — 2026-07-10, claim key `["e:jan","HAS",0,"a:birthplace",["src:maria"]]`
```

The birth year traces to the birth certificate, not to Grandma — three sources still coexist in the store, and the citation shows exactly which one the sentence stands on. When a claim carries a §9.8 source span, the footnote appends the decoded `source#Lx-Ly` location (as a link for HTTP(S)); the JSON APIs expose the same structured reference. An inline splice must be deterministic: when several sources contest a fact it reports *ambiguous* and exits nonzero, and `--resolve` (the spec §26 policy) is the fix. `--as-of` renders the report as belief stood at a past moment, and the template stays under version control while the store evolves. See [`@cavelang/view`](packages/view) and spec §31.

From here: `cave mcp --db family.db` serves the store to any MCP client, and `pnpm exec cave help` lists everything. More worked examples — including a production-incident postmortem with confidence-filtered root-cause queries — live in [`examples/`](examples).

### Optional formal reasoning

[`@cavelang/solver`](packages/solver) adds bounded feasibility, optimization,
counterexample, and sensitivity workflows over typed scenario snapshots. The
operations preserve distinct `satisfied`, `optimal`, `unsatisfied`, and
`unknown` results, record their model/snapshot scope, and use deterministic
tie-breaking rather than accepting arbitrary backend assignments.

Z3 remains an opt-in Node.js dependency. Its package includes one allowlisted
architecture fixture for exercising the workflow boundary without accepting
raw solver programs:

```sh
cave-solver-workflow architecture optimization --team-size 10 --deployment-frequency 6
cave-solver-workflow architecture sensitivity --team-size 10 --from 1 --to 12
```

Solver output is not a write. `@cavelang/scenario` exposes an explicit,
atomic, idempotent `Record` transition for immutable result artifacts, then
keeps recommendations, human decisions, action audit records, and external
effect audit records in separate versioned namespaces. Replay reports model or
solver-version drift without evaluating again. Passing proposed parameters to
`actProposal` still rechecks the current action declaration and preconditions
before the governed action engine can append anything. See the
[`solver`](packages/solver), [`solver-z3`](packages/solver-z3), and
[`scenario`](packages/scenario) and [`act`](packages/act) package references
for the exact APIs.

### Syntax highlighting

One tree-sitter grammar ([`packages/tree-sitter-cave`](packages/tree-sitter-cave)) drives every surface: `cave highlight` (and `cave export` on a terminal) colors CAVE text with the grammar's own `highlights.scm`, the [VSCode extension](editors/vscode) replays the same query as semantic tokens, and tree-sitter-native editors (Neovim, Helix, Zed) can point at the grammar directly.

## What's left

The roadmap is complete — every numbered item shipped, and the knowledge loop (sense, model, conclude, act, trust, distribute) runs on one machine. [TODO.md](TODO.md) tracks what remains: the deliberately unfinished edges, the open design decisions, and issues found by analysis. [BUGS.md](BUGS.md) indexes suspected bugs with self-contained repro notes under [`bugs/`](bugs/).

## Development

```sh
pnpm test             # all packages, bottom-up
pnpm typecheck
pnpm exec cave demo   # cave-loop multi-hop recovery demo (§18)
```

Implementation lives in a pnpm TypeScript monorepo — see [IMPLEMENTATION.md](IMPLEMENTATION.md) for the package map (including the solver-neutral `solver`, typed `scenario` bindings, optional `solver-z3` adapter, and the ordinary CAVE language, data, behavior, integration, and presentation packages), toolchain, and cross-package design decisions.

## The specification

The full spec is split across four Claude Code skills in [`.claude/skills/`](.claude/skills). Spec section numbers (§) are preserved there, so section references throughout the package READMEs resolve as follows:

| Skill | Sections | Covers |
|---|---|---|
| [`cave-writing`](.claude/skills/cave-writing/SKILL.md) | §3–§8, §11, §16, §22 | Syntax, lexical rules, verbs, `REVERSE` & `RENAMED-TO`, metadata, values/units/uncertainty, trajectories & time contexts, indentation & continuation, tags & topics, grammar, spec card |
| [`cave-extraction`](.claude/skills/cave-extraction/SKILL.md) | §14–§15, §21, §23 | Converting text to CAVE, granularity, operating modes, worked example, deterministic structured ingestion (`cave connect`) |
| [`cave-storage-query`](.claude/skills/cave-storage-query/SKILL.md) | §9, §12–§13, §20, §24–§32 | Append-only belief evolution, claim keys, sensitivity and source spans, CAVE-Q, SQLite schema, canonicalization, shape expectations & knowledge health, rules & derivation, actions & governed writes, contradiction resolution, alias discovery, store merge, automations, the human read surface, cited reports, temporal values & valid time |
| [`cave-design`](.claude/skills/cave-design/SKILL.md) | §0–§2, §10, §17–§19 | Status conventions, design goals, claim model, probabilistic layer, Draft unified grammar, agent layer, rationale |

Sections are **Normative** unless marked Legacy, Draft, or Non-normative (§0). The status of the implementation against the spec is tracked in [IMPLEMENTATION.md](IMPLEMENTATION.md#status-vs-the-spec).

## Cheat sheet (§22)

```cave
subject VERB [NOT] object                [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
subject HAS attribute: value [+/- delta [(Nσ)]] [@context...] [#tag[:value]...] [@ N%] [!] [; comment]

VERB REVERSE INVERSE-VERB                ; declare inverse; left side is primary
OLD-VERB RENAMED-TO NEW-VERB             ; prefer NEW; both keep OLD's storage history
  parent VERB object
    VERB object2                         ; continuation: inherits parent subject
    INVERSE-VERB other                   ; continuation: parent lands in object position
    WHEN condition                       ; qualifier edge on the parent claim
```

Disambiguation: `@` + space = confidence, `@` + no space = context; `#` begins a tag, first `:` inside it splits key/value; `:` in payload binds attribute to value; `/` after a number is "per", elsewhere entity scope.
