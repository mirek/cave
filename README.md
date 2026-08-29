# CAVE — Compressed Atomic Verb Expressions

CAVE is a small plain-text language for writing down what you know, one
claim per line, plus a command-line tool that stores those claims in SQLite
and lets you ask questions across them.

```cave
web USES ui
core HAS version: 1.4.0
core HAS maintainer: bob @src:standup @ 60% ; "I think bob took over core"
```

A claim is `subject VERB object`. Everything after that — a source, a
confidence, a comment — is optional. Claims are only ever appended, never
edited, so the store remembers how a belief changed; queries can walk chains
of claims, read relations backwards, filter by confidence, and answer as of an
earlier date. Rules derive new claims from old ones, LLM agents and structured
files can write claims for you, and reports cite the exact claim behind every
sentence.

This README is a tutorial. It builds one example a step at a time — first a
monorepo, then a market watchlist — adding one idea per step, and every
command's output is from an actual run. The reference material lives in the
[package docs](#where-next) and the [specification](#the-specification).

## Install

```sh
pnpm i -g @cavelang/cli
copilot mcp add cave -- cave mcp --db "$HOME/cave.db"
```

The first line installs the `cave` command; the second (optional) registers it
as an MCP server for GitHub Copilot CLI, which [step 12](#12-look-at-it-talk-to-it)
returns to. To update later:

```sh
pnpm up --latest -g @cavelang/cli
```

The supported Node.js lines are 22, 24, and 26: 22.18.0 is the exact minimum,
24.18.0 Active LTS is the recommended production runtime, and 26.4.0 Current is
also tested. The supported CI platforms are Ubuntu 24.04, macOS 15, and Windows
Server 2022. CAVE stores knowledge in a local SQLite database; `--db` is
optional everywhere and defaults to `$CAVE_DB`, or `cave.db` in the current
directory.

## Tutorial I — a monorepo, one claim at a time

The files for this part are in [`examples/monorepo/`](examples/monorepo); the
commands below assume you are inside that directory (`cd examples/monorepo`)
and start with no database.

### 1. One claim

A claim is three tokens: a subject, an UPPERCASE verb, and an object.

```cave
web USES ui
```

Names are lowercase; `/` scopes them (`web/src/app.ts`, `team/platform`). The
verb `USES` is one of a small standard set (`IS`, `HAS`, `USES`, `NEEDS`,
`CONTAINS`, `CAUSE`, `FIX`, …); you will define your own in step 6.
`cave parse` lints without storing anything:

```
$ echo 'web USES ui' | cave parse
ok: 1 claim, 1 blank
```

### 2. A few claims, in a store

Five packages and what they use — [`packages.cave`](examples/monorepo/packages.cave):

```cave
; a small monorepo: which package uses which
web USES ui
web USES api-client
ui USES core
api-client USES core
docs USES ui
```

`;` starts a comment. `cave add` stores the file; `cave query` asks a
question, where `?p` is a variable that binds to whatever fits:

```
$ cave add --db repo.db packages.cave
added 5 claim(s), 0 edge(s)

$ cave query --db repo.db 'web USES ?p'
?p = ui
?p = api-client

$ cave query --db repo.db '?p USES core'
?p = ui
?p = api-client
```

### 3. Read it backwards

The standard relation verbs come with inverses (`USES` ↔ `USED-BY`,
`CONTAINS` ↔ `PART-OF`, `CAUSE` ↔ `CAUSED-BY`, …). The inverse is not a
second copy of the fact: it reads the *same stored rows* from the other end.

```
$ cave query --db repo.db 'ui USED-BY ?p'
?p = web
?p = docs
```

### 4. Follow the chain

Nobody wrote `web USES core`, but `web` uses `ui` which uses `core`. `VERB+`
follows a relation for as many hops as it takes — so "what breaks if `core`
changes?" is one query:

```
$ cave query --db repo.db '?p USES+ core'
?p = api-client
?p = docs
?p = ui
?p = web

$ cave query --db repo.db 'docs USES+ ?p'
?p = core
?p = ui
```

### 5. Attributes, types, tags

`IS` gives a thing a type; `HAS name: value` gives it an attribute; `#tag`
labels a claim. An incomplete line followed by indented lines is shorthand
for repeating the prefix — [`details.cave`](examples/monorepo/details.cave):

```cave
; what kind of thing each package is, and who owns it
web IS app
docs IS app
ui IS library #public
core IS library #public
api-client IS library

core HAS
  version: 1.4.0
  owner: team/platform
ui HAS owner: team/design
web HAS owner: team/growth
docs HAS owner: team/design
```

Patterns can mention types, tags, and attribute values:

```
$ cave add --db repo.db details.cave
added 10 claim(s), 0 edge(s)

$ cave query --db repo.db '?p IS library #public'
?p = ui
?p = core

$ cave query --db repo.db '?p HAS owner: team/design'
?p = ui
?p = docs

$ cave query --db repo.db 'core HAS version: ?v'
?v = 1.4.0
```

### 6. Zoom into files, with a verb of your own

Packages contain files, and files import files. `CONTAINS` is standard;
`IMPORTS` is not, so [`files.cave`](examples/monorepo/files.cave) declares it
— in the same file, as two ordinary claims — together with its inverse. An
indented line that starts with a verb is a *continuation*: it inherits the
subject of the line above.

```cave
; zoom in: the files inside the packages, and what imports what
IMPORTS IS verb ; file X imports file Y
IMPORTS REVERSE IMPORTED-BY

web CONTAINS web/src/app.ts
  CONTAINS web/src/checkout.ts
ui CONTAINS ui/src/button.ts
  CONTAINS ui/src/modal.ts
core CONTAINS core/src/money.ts

web/src/app.ts IMPORTS ui/src/modal.ts
web/src/checkout.ts IMPORTS ui/src/button.ts
  IMPORTS core/src/money.ts
ui/src/button.ts IMPORTS core/src/money.ts
```

The new verb queries exactly like a built-in one, inverse and transitive
included — "which files would a change to `money.ts` reach?":

```
$ cave add --db repo.db files.cave
added 11 claim(s), 0 edge(s)

$ cave query --db repo.db '?f PART-OF web'
?f = web/src/app.ts
?f = web/src/checkout.ts

$ cave query --db repo.db 'core/src/money.ts IMPORTED-BY+ ?f'
?f = ui/src/button.ts
?f = web/src/checkout.ts
```

### 7. Stop typing — connect structured data

Real dependency lists come from a script, not a keyboard. `cave connect` maps
CSV/JSON/SQLite records through a *template*: an ordinary CAVE file whose
`?variables` are column names. Two packages were just added to the repo —
[`deps.csv`](examples/monorepo/deps.csv) and
[`deps.map.cave`](examples/monorepo/deps.map.cave):

```csv
package,uses
billing,core
billing,api-client
cli,core
cli,billing
```

```cave
; one CSV row = one dependency edge; ?package and ?uses are the column names
?package USES ?uses
```

Same input, same claims, every time — and a second run does nothing, because
each row is remembered by digest:

```
$ cave connect deps.csv --map deps.map.cave --db repo.db
connect: 4 record(s): 4 mapped, 0 skipped (unchanged); +4 claim(s)

$ cave connect deps.csv --map deps.map.cave --db repo.db
connect: 4 record(s): 0 mapped, 4 skipped (unchanged); +0 claim(s)
  note: prelude unchanged, skipped

$ cave query --db repo.db '?p USES+ core'
?p = api-client
?p = billing
?p = cli
?p = docs
?p = ui
?p = web
```

Now change the row `billing,api-client` to `billing,ui` in `deps.csv` and run
it again with `--prune`. The edge that disappeared from the source is
retracted, the new one added — and `--all` shows that the retracted edge is
still in the history, not deleted:

```
$ cave connect deps.csv --map deps.map.cave --db repo.db --prune
connect: 4 record(s): 1 mapped, 3 skipped (unchanged); +1 claim(s), 1 retracted, 1 record(s) pruned
  note: prelude unchanged, skipped

$ cave query --db repo.db 'billing USES ?p'
?p = core
?p = ui

$ cave query --db repo.db 'billing USES ?p' --all
?p = core
?p = api-client
?p = ui
?p = api-client
```

(`--watch` keeps a file connected continuously; `--query` answers a pattern
over the union of store and file without storing anything. See
[`@cavelang/connect`](packages/connect).)

### 8. Say how sure you are, and why

So far every claim was certain and anonymous. Two more pieces of metadata:
`@src:name` says where a claim came from and `@ N%` how much you believe it.
Two sources disagree about who maintains `core`:

```
$ printf '%s\n' 'core HAS maintainer: alice @src:codeowners' \
    'core HAS maintainer: bob @src:standup @ 60% ; "I think bob took over core"' \
    | cave add --db repo.db
added 2 claim(s), 0 edge(s)

$ cave query --db repo.db 'core HAS maintainer: ?m'
?m = alice
?m = bob

$ cave query --db repo.db 'core HAS maintainer: ?m' 'WHERE conf >= 0.8'
?m = alice
```

Both claims coexist — a contradiction is two claims with different sources,
not an error. When alice leaves, you do not edit anything: you append the
same claim at `0%`, which retracts it. The history keeps all three lines, and
`cave export` prints them in order:

```
$ echo 'core HAS maintainer: alice @src:codeowners @ 0% ; alice left in July' | cave add --db repo.db
added 1 claim(s), 0 edge(s)

$ cave query --db repo.db 'core HAS maintainer: ?m'
?m = bob

$ cave export --db repo.db | grep -A3 'core HAS maintainer'
core HAS maintainer:
  alice @src:codeowners
  bob @src:standup @ 60% ; "I think bob took over core"
  alice @src:codeowners @ 0% ; alice left in July
```

Because nothing is ever overwritten, `cave query … --as-of 2026-07-01` answers
as the store stood on that date, and `cave resolve` ranks contested facts
(source reliability, confidence, recency) so `--resolve` returns one winner
per fact. Note that permanence includes mistakes: there is no claim-level
delete, so do not ingest secrets (spec §9.6).

### 9. Rules conclude what nobody wrote

Step 4 *asked* which packages reach `core`. A rule can *conclude* it and
record the conclusion, with a reason attached. A rule is a line of the form
`premises => conclusion`, where each premise is a query pattern —
[`advisories.cave`](examples/monorepo/advisories.cave):

```cave
; a security advisory against a package reaches everything that uses it, directly or not
AFFECTS IS verb ; advisory X affects package Y
AFFECTS REVERSE AFFECTED-BY
EXPOSED-TO IS verb ; package X is exposed to advisory Y through its dependencies
EXPOSED-TO REVERSE EXPOSES

?adv AFFECTS ?dep, ?pkg USES+ ?dep => ?pkg EXPOSED-TO ?adv ; exposure travels up the dependency chain
```

An advisory arrives against `core`; `cave derive` loads the rules and fires
them:

```
$ echo 'cve-2026-0042 AFFECTS core @ 90% ; reported against core 1.4.0' | cave add --db repo.db
added 1 claim(s), 0 edge(s)

$ cave derive --db repo.db advisories.cave
declared 1 rule(s), +4 prelude claim(s)
rule/35e6066ad7f7: 6 solution(s), +6 appended, 0 updated, 0 retracted, 0 unchanged ; exposure travels up the dependency chain
derived: +6 appended, 0 updated, 0 retracted, 0 unchanged (2 pass(es))

$ cave query --db repo.db '?p EXPOSED-TO cve-2026-0042'
?p = api-client
?p = billing
?p = cli
?p = docs
?p = ui
?p = web
```

Every derived claim carries its confidence (90%, inherited from the
advisory) and its *lineage*: `BECAUSE` points at the premises, `VIA` at the
rule. Running `derive` again changes nothing, and if the advisory is later
retracted the conclusions go with it.

```
$ cave export --db repo.db | grep -A3 'billing EXPOSED-TO'
billing EXPOSED-TO cve-2026-0042 @src:rule/35e6066ad7f7 @ 90%
  BECAUSE cve-2026-0042 AFFECTS core @src:cli @ 90% ; reported against core 1.4.0
  VIA rule/35e6066ad7f7 HAS rule: `?adv AFFECTS ?dep, ?pkg USES+ ?dep => ?pkg EXPOSED-TO ?adv` @src:cave-derive ; exposure travels up the dependency chain

$ cave derive --db repo.db
rule/35e6066ad7f7: unchanged premises, skipped ; exposure travels up the dependency chain
derived: +0 appended, 0 updated, 0 retracted, 0 unchanged (1 pass(es))
```

### 10. Say what a good record looks like

Schema is also just claims. `EXPECTS` says what every instance of a type
should carry — [`shapes.cave`](examples/monorepo/shapes.cave):

```cave
; what a well-described package looks like
library EXPECTS owner
app EXPECTS owner
```

`cave check` is the health report: which expectations are unmet, which
beliefs sit in the 30–70% "someone should look at this" band, and how much of
the store is typed. It exits 1 while a violation remains — and adding the
missing owner fixes it:

```
$ cave add --db repo.db shapes.cave
added 2 claim(s), 0 edge(s)

$ cave check --db repo.db
shape: 2 expectation(s), 5 instance(s), 4/5 satisfied
violations (1):
  api-client missing attribute owner (api-client IS library; library EXPECTS owner)
review candidates (1, conf 0.3-0.7):
  core HAS maintainer: bob @src:standup @ 60% ; "I think bob took over core"
coverage: 58 row(s), 55 fact(s) — 52 current, 3 retracted, 0 negated; avg conf 98%, 0 low (< 0.3); 24 entities, 5 typed

$ echo 'api-client HAS owner: team/platform' | cave add --db repo.db
added 1 claim(s), 0 edge(s)

$ cave check --db repo.db
shape: 2 expectation(s), 5 instance(s), 5/5 satisfied
review candidates (1, conf 0.3-0.7):
  core HAS maintainer: bob @src:standup @ 60% ; "I think bob took over core"
coverage: 59 row(s), 56 fact(s) — 53 current, 3 retracted, 0 negated; avg conf 98%, 0 low (< 0.3); 24 entities, 5 typed
```

(`cave add --check` refuses an append that would introduce a new violation.)

### 11. Ship a document that cites its claims

A query answers you; a report is for someone else, and it should say where
each fact came from. `cave report` renders a markdown template: an inline
`` `cave-q: …` `` splices one value into prose, and a fenced `cave-q` block
repeats a fragment per match — [`brief.md`](examples/monorepo/brief.md):

````markdown
# Dependency brief

`core` is at version `cave-q: core HAS version: ?v`, owned by `cave-q: core HAS owner: ?team`.

## Packages exposed to cve-2026-0042

```cave-q
?pkg EXPOSED-TO cve-2026-0042
- ?pkg
```
````

Every rendered fact gets a footnote with the claim behind it:

```
$ cave report --db repo.db brief.md
# Dependency brief

`core` is at version 1.4.0[^c1], owned by team/platform[^c2].

## Packages exposed to cve-2026-0042

- api-client [^c3]
- billing [^c4]
- cli [^c5]
- docs [^c6]
- ui [^c7]
- web [^c8]

[^c1]: `core HAS version: 1.4.0 @src:cli` — 2026-08-29, claim key `["e:core","HAS",0,"a:version",["src:cli"]]`
[^c2]: `core HAS owner: team/platform @src:cli` — 2026-08-29, claim key `["e:core","HAS",0,"a:owner",["src:cli"]]`
[^c3]: `api-client EXPOSED-TO cve-2026-0042 @src:rule/35e6066ad7f7 @ 90%` — 2026-08-29, claim key `["e:api-client","EXPOSED-TO",0,"r:e:cve-2026-0042",["src:rule/35e6066ad7f7"]]`
…
```

### 12. Look at it, talk to it

`cave serve` puts a read-only web page over the store — search, one page per
entity with both relation directions, the belief history of every claim, and
the `BECAUSE`/`VIA` tree behind derived ones:

```
$ cave serve --db repo.db
serving repo.db at http://127.0.0.1:2283/ (sensitivity <= internal, read-only, ctrl-c to stop)
```

`cave mcp` serves the same store to any MCP client, so an agent can record,
search and query it. The [install](#install) line registered one for GitHub
Copilot CLI at `~/cave.db`; `copilot --allow-tool=cave` then answers prompts
like:

```text
Use CAVE to record that billing USES payments-gateway, 80% confidence,
based on today's design review.

Ask CAVE what is transitively exposed to cve-2026-0042 and show the claims.
```

And `cave ingest 'docs/**/*.md' --db repo.db --agent 'claude -p --mcp-config
{mcp-config} --allowedTools "mcp__cave__*"'` points an agent at your own
documents and lets it write the claims — which is where part II starts.

## Tutorial II — a market watchlist

Part I hand-wrote most claims and asked structural questions. This part
models a world that changes daily, lets an LLM do the reading, and closes
the loop with decisions and automation. Files are in
[`examples/market/`](examples/market) (`cd examples/market`, fresh database).
The companies are fictional.

### 13. Model the world

Companies, the *themes* that move them, and who supplies whom. Confidence
does double duty here: on `DRIVES` it is the exposure weight, and a
`#sign:-1` tag says the theme going up is bad for that company —
[`ontology.cave`](examples/market/ontology.cave):

```cave
; the world model: companies, the themes that move them, and who supplies whom
DRIVES IS verb ; theme X moves company or theme Y; confidence = how much of Y's fortune X explains
DRIVES REVERSE DRIVEN-BY
SUPPLIES IS verb ; company X sells a critical input to company Y
SUPPLIES REVERSE SOURCES-FROM

chipco IS company ; designs AI accelerators
fabco IS company ; leading-edge foundry
cloudco IS company ; hyperscaler buying the accelerators
powerco IS company ; data-center power and cooling

theme/ai-capex IS theme ; how much hyperscalers spend on AI infrastructure
theme/export-controls IS theme ; restrictions on selling advanced chips abroad
theme/datacenter-power IS theme ; power and cooling as the bottleneck

theme/ai-capex DRIVES chipco @ 90% #sign:+1
theme/ai-capex DRIVES fabco @ 70% #sign:+1
theme/ai-capex DRIVES powerco @ 80% #sign:+1
theme/ai-capex DRIVES cloudco @ 50% #sign:-1 ; capex is a cost for the spender
theme/export-controls DRIVES chipco @ 70% #sign:-1
theme/ai-capex DRIVES theme/datacenter-power @ 80% #sign:+1

fabco SUPPLIES chipco @ 95%
chipco SUPPLIES cloudco @ 80%
powerco SUPPLIES cloudco @ 50%
```

```
$ cave add --db market.db ontology.cave
added 20 claim(s), 0 edge(s)

$ cave query --db market.db 'chipco DRIVEN-BY ?t #sign:-1'
?t = theme/export-controls

$ cave query --db market.db '?s SUPPLIES+ cloudco'
?s = chipco
?s = fabco
?s = powerco
```

### 14. Let an LLM read the news

[`news/`](examples/market/news) holds short articles. `cave ingest` hands
them to any headless agent — here Claude Code, with
[`instructions.md`](examples/market/instructions.md) telling it to record
each article as a `news/<date>/<slug>` entity that `AFFECTS` one of the
declared themes, `#direction:up` or `down`, with its confidence. `--stdout`
means the agent just prints CAVE; `cave` lints it and stores it, and
remembers each file by digest so re-runs only read what changed:

```
$ cave ingest news/2026-08-12-capex-guidance.md news/2026-08-14-export-rules.md \
    --db market.db --stdout --embed --instructions instructions.md --agent 'claude -p'
ingest (strict): 2 source(s) matched, 0 skipped (unchanged), 1 batch(es), applied
batch 1/1 (2 file(s)): +9 claim(s)
source accepted: news/2026-08-12-capex-guidance.md — batch 1
source accepted: news/2026-08-14-export-rules.md — batch 1
done: +9 claim(s)
```

What the model wrote — note the `@src:file#L3-L7` spans pointing at the exact
sentences, and the hedged 60% on a draft rule:

```
$ cave export --db market.db | grep -A6 '^news/2026-08-14'
news/2026-08-14/export-rules
  IS news @src:news/2026-08-14-export-rules.md#L1-L3
  HAS
    headline: "Regulator drafts wider export licensing for advanced accelerators" @src:news/2026-08-14-export-rules.md#L1
    date: 2026-08-14 @src:news/2026-08-14-export-rules.md#L3
  AFFECTS theme/export-controls @src:news/2026-08-14-export-rules.md#L3-L7 #direction:up @ 60% ; draft rule only, 30-day consultation open, final shape uncertain
```

(LLM output varies run to run; this is one real run. Its claims are saved
as [`news.cave`](examples/market/news.cave): without an agent, `cave add
--db market.db news.cave` records the same claims — but not the per-file
digests `cave ingest` keeps, so in step 18 add
[`news-2026-08-20.cave`](examples/market/news-2026-08-20.cave) the same way
instead of running `cave ingest`.)

### 15. Rules with a sign

News moves a theme; a theme moves a company; so news moves the company — up
if the signs agree, down if they don't. Four rules, one per case; the tags in
the premises are filters and the tag in the conclusion is recorded —
[`rules.cave`](examples/market/rules.cave):

```cave
PRESSURES IS verb ; news X pushes company Y up or down, through a theme
PRESSURES REVERSE PRESSURED-BY

?n AFFECTS ?t #direction:up,   ?t DRIVES ?c #sign:+1 => ?n PRESSURES ?c #direction:up
?n AFFECTS ?t #direction:up,   ?t DRIVES ?c #sign:-1 => ?n PRESSURES ?c #direction:down
?n AFFECTS ?t #direction:down, ?t DRIVES ?c #sign:+1 => ?n PRESSURES ?c #direction:down
?n AFFECTS ?t #direction:down, ?t DRIVES ?c #sign:-1 => ?n PRESSURES ?c #direction:up
```

```
$ cave derive --db market.db rules.cave
declared 4 rule(s), +2 prelude claim(s)
rule/190b9b9b17da: 4 solution(s), +4 appended, 0 updated, 0 retracted, 0 unchanged
rule/01455622519d: 2 solution(s), +2 appended, 0 updated, 0 retracted, 0 unchanged
rule/5b285a4156f6: 0 solution(s), +0 appended, 0 updated, 0 retracted, 0 unchanged
rule/4ebbeff28dc5: 0 solution(s), +0 appended, 0 updated, 0 retracted, 0 unchanged
derived: +6 appended, 0 updated, 0 retracted, 0 unchanged (2 pass(es))

$ cave query --db market.db '?n PRESSURES ?c #direction:down'
?n = news/2026-08-12/capex-guidance  ?c = cloudco
?n = news/2026-08-14/export-rules  ?c = chipco
```

The derived confidence is the product of the premises' (60% × 70% = 42%), and
the lineage says which sentence and which exposure it rests on:

```
$ cave export --db market.db | grep -A4 '^news/2026-08-14/export-rules PRESSURES chipco'
news/2026-08-14/export-rules PRESSURES chipco @src:rule/01455622519d #direction:down @ 42%
  BECAUSE
    news/2026-08-14/export-rules AFFECTS theme/export-controls @src:news/2026-08-14-export-rules.md#L3-L7 #direction:up @ 60% ; draft rule only, 30-day consultation open, final shape uncertain
    theme/export-controls DRIVES chipco @src:cli #sign:-1 @ 70%
  VIA rule/01455622519d HAS rule: `?n AFFECTS ?t #direction:up, ?t DRIVES ?c #sign:-1 => ?n PRESSURES ?c #direction:down` @src:cave-derive
```

### 16. Time is part of the value

Step 8's `--as-of` is about when the *store* learned something. A claim can
also say when in the *world* it holds: a date-like context scopes it, and a
`A -> B` value moves linearly across that range. `--at` reads the value at an
instant:

```
$ echo 'theme/ai-capex HAS spend: 300B -> 450B USD/yr @2025..2026' | cave add --db market.db
added 1 claim(s), 0 edge(s)

$ cave query --db market.db 'theme/ai-capex HAS spend: ?v' --at 2025-07
?v = 374.4B USD/yr

$ cave query --db market.db 'theme/ai-capex HAS spend: ?v' --at 2026-08
?v = 450B USD/yr
```

### 17. Decisions are governed writes

A rule fires on its own; an *action* runs when someone calls it. It is the
same `premises => conclusion` shape with parameters (`?company`, `?stance`),
declared under a stable name — [`actions.cave`](examples/market/actions.cave):

```cave
; governed writes: the only ways a decision gets recorded
action/set-stance HAS action: `?company, ?stance, ?company IS company => ?company HAS stance: ?stance` ; record a portfolio stance on a company
action/flag-review HAS action: `?company, ?news, ?news PRESSURES ?company #direction:down, ?company HAS stance: overweight => ?company NEEDS review` ; an overweight name got bad news — both must be current belief
```

Preconditions are checked against current belief; if they fail nothing is
written — `flag-review` cannot be talked into a review by news that did not
actually pressure the company down. Over MCP every action becomes an
`act_<name>` tool, so an agent gets a vocabulary of allowed writes instead of
free-form appends:

```
$ cave act --db market.db --declare actions.cave
declared 2 action(s)

$ cave act --db market.db set-stance company=chipco stance=overweight
executed action/set-stance: +1 appended, 0 updated, 0 unchanged (1 solution(s))
  appended: chipco HAS stance: overweight

$ cave act --db market.db set-stance company=nobody stance=overweight
cave act: precondition failed — no current belief satisfies "?company IS company"

$ cave act --db market.db flag-review company=chipco news=news/2026-08-12/capex-guidance
cave act: precondition failed — no current belief satisfies "?news PRESSURES ?company #direction:down"
```

### 18. The store reacts

An *automation* pairs a trigger pattern with steps and fires when new claims
match — [`automations.cave`](examples/market/automations.cave):

```cave
automation/review-bad-news HAS automation: `?news PRESSURES ?company #direction:down, ?company HAS stance: overweight => action/flag-review` ; overweight name under pressure -> ask for a review
```

The trigger's variables feed the action's same-named parameters. Declaring
an automation *arms* it: the bad news already in the store is state, not an
event, so the first cycle is quiet. Then the third article arrives —
`cave ingest 'news/*.md' …` again skips the two it has read and records the
new one (without an agent: `cave add --db market.db news-2026-08-20.cave`,
that run's output) — and the next `--once` cycle fires the rules, sees the
new pressure on an overweight name, and executes the action:

```
$ cave automate --db market.db --declare automations.cave
declared 1 automation(s)

$ cave automate --db market.db --once
settled: 0 firing(s) over 1 pass(es); derived +0 appended, 0 updated, 0 retracted

$ cave ingest 'news/*.md' --db market.db --stdout --embed --instructions instructions.md --agent 'claude -p'
ingest (strict): 3 source(s) matched, 2 skipped (unchanged), 1 batch(es), applied
batch 1/1 (1 file(s)): +4 claim(s)
source skipped: news/2026-08-12-capex-guidance.md
source skipped: news/2026-08-14-export-rules.md
source accepted: news/2026-08-20-licence-suspension.md — batch 1
done: +4 claim(s)

$ cave automate --db market.db --once
automation/review-bad-news: fired 1 solution(s) ; overweight name under pressure -> ask for a review
  ?news = news/2026-08-20/licence-suspension  ?company = chipco
    action/flag-review: ok (+1 appended, 0 updated, 0 unchanged)
settled: 1 firing(s) over 2 pass(es); derived +1 appended, 0 updated, 0 retracted
```

The result explains itself all the way down — the review request, the
pressure and the stance it depends on, the rule and the sentence behind the
pressure, the action that recorded the stance:

```
$ cave export --db market.db | grep -A12 '^chipco NEEDS review'
chipco NEEDS review @src:action/flag-review
  BECAUSE
    news/2026-08-20/licence-suspension PRESSURES chipco @src:rule/01455622519d #direction:down @ 59.5%
      BECAUSE
        news/2026-08-20/licence-suspension AFFECTS theme/export-controls @src:news/2026-08-20-licence-suspension.md#L3-L6 #direction:up @ 85% ; existing licences suspended with immediate effect, in-transit shipments exempt, no review timeline
        theme/export-controls DRIVES chipco @src:cli #sign:-1 @ 70%
      VIA rule/01455622519d HAS rule: `?n AFFECTS ?t #direction:up, ?t DRIVES ?c #sign:-1 => ?n PRESSURES ?c #direction:down` @src:cave-derive
    chipco HAS stance: overweight @src:action/set-stance
      BECAUSE chipco IS company @src:cli ; designs AI accelerators
      VIA action/set-stance HAS action: `?company, ?stance, ?company IS company => ?company HAS stance: ?stance` @src:cave-act ; record a portfolio stance on a company
  VIA action/flag-review HAS action: `?company, ?news, ?news PRESSURES ?company #direction:down, ?company HAS stance: overweight => ?company NEEDS review` @src:cave-act ; an overweight name got bad news — both must be current belief
```

Without `--once`, `cave automate` keeps watching the store; steps can also be
a `hook/<name>` shell command from a config file or a quoted prompt an agent
answers in CAVE. With `cave connect --watch` on the other end, sense → model
→ conclude → act → record runs unattended.

### 19. The morning brief

Everything above collapses into one cited page —
[`brief.md`](examples/market/brief.md):

```
$ cave report --db market.db brief.md --at 2026-08
# Morning brief

AI capex is running at 450B USD/yr[^c1] this year.

## Names under pressure

- **cloudco** — down, on news/2026-08-12/capex-guidance [^c2]
- **chipco** — down, on news/2026-08-14/export-rules [^c3]
- **chipco** — down, on news/2026-08-20/licence-suspension [^c4]

## Needs a decision

- chipco [^c5]

[^c1]: `theme/ai-capex HAS spend: 300B -> 450B USD/yr @2025..2026 @src:cli` — 2026-08-29, claim key `["e:theme/ai-capex","HAS",0,"a:spend",["2025..2026","src:cli"]]`
[^c2]: `news/2026-08-12/capex-guidance PRESSURES cloudco @src:rule/01455622519d #direction:down @ 45%` — 2026-08-29, claim key `["e:news/2026-08-12/capex-guidance","PRESSURES",0,"r:e:cloudco",["src:rule/01455622519d"]]`
…
```

Each bullet traces to a derived claim, which traces to a sentence in an
article and an exposure you wrote by hand. `--as-of` renders the same brief
as belief stood on an earlier day.

## Where next

- **The full tour** — [`examples/family-history/`](examples/family-history)
  pushes one set of notes through *every* surface: sensitivity ceilings and
  backups, extraction evals (`cave eval`), alias discovery, memory
  reconstruction, store sync and git-hosted stores, the read surface, and the
  optional formal solver.
- **Examples index** — [`examples/`](examples) lists every runnable fixture,
  including a production-incident postmortem.
- **Package reference** — one README per package: [`cli`](packages/cli)
  (every command and flag), [`query`](packages/query) (CAVE-Q),
  [`store`](packages/store), [`rules`](packages/rules), [`act`](packages/act),
  [`automate`](packages/automate), [`connect`](packages/connect),
  [`ingest`](packages/ingest), [`shape`](packages/shape),
  [`view`](packages/view), [`sync`](packages/sync), [`eval`](packages/eval),
  [`loop`](packages/loop), [`mcp`](packages/mcp).
- **Agents** — the [MCP server](packages/mcp) is self-describing (a writing
  card at initialization plus a `cave_help` tool); the portable
  [CAVE Agent Skill](skills/cave/SKILL.md) adds workflow guidance for Copilot,
  Codex, Claude Code and other hosts (`gh skill install mirek/cave cave
  --agent github-copilot --scope user`).
- **Editors** — one tree-sitter grammar
  ([`packages/tree-sitter-cave`](packages/tree-sitter-cave)) drives
  `cave highlight`, the [VS Code extension](editors/vscode), and
  tree-sitter-native editors.
- **The book and the playground** — the website hosts a continuous system
  guide as PDF and a browser playground that runs the real parser, store and
  query engine on SQLite WebAssembly.

## Development

```sh
make bootstrap         # install with the exact pnpm version declared by the repo
pnpm clean             # remove generated output from every workspace
pnpm test              # all packages, bottom-up
pnpm build             # typecheck + emit (`pnpm typecheck` is an alias)
pnpm bench:performance # deterministic representative regression budgets
pnpm exec cave demo    # cave-loop multi-hop recovery demo (§18)
```

The performance gate covers canonical-text import/export, contested-belief
resolution, large shape checks, bounded query pages, seeded transitive queries,
and small/5,000-row sensitivity-scoped views, comparing timings with the
recorded [`performance-baseline.json`](benchmarks/performance-baseline.json).

Implementation lives in a pnpm TypeScript monorepo — see
[IMPLEMENTATION.md](IMPLEMENTATION.md) for the package map and toolchain,
[ARCHITECTURE.md](ARCHITECTURE.md) for runtime flows and invariants, and
[PACKAGE_SURFACES.md](PACKAGE_SURFACES.md) for the supported npm entry points
and migration from former implementation-package names. The roadmap is
complete; [TODO.md](TODO.md) is the queue,
[PROJECT-BOUNDARIES.md](PROJECT-BOUNDARIES.md) records deliberately excluded
extensions, and [BUGS.md](BUGS.md) indexes suspected defects.

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

subject HAS                              ; incomplete headers prefix children recursively
  attribute: value
  other: value

VERB REVERSE INVERSE-VERB                ; declare inverse; left side is primary
OLD-VERB RENAMED-TO NEW-VERB             ; prefer NEW; both keep OLD's storage history
  parent VERB object
    VERB object2                         ; continuation: inherits parent subject
    INVERSE-VERB other                   ; continuation: parent lands in object position
    WHEN condition                       ; qualifier edge on the parent claim
```

Disambiguation: `@` + space = confidence, `@` + no space = context; `#` begins a tag, first `:` inside it splits key/value; `:` in payload binds attribute to value; `/` after a number is "per", elsewhere entity scope.
