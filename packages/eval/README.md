# @cavelang/eval

The evals harness (ROADMAP items 9 and 10): golden-fixture extraction,
query and reconstruction evals as plain files. Without it, changes to
ingestion prompts, agent choice, extraction instructions or the loop
policy are unfalsifiable — `cave eval` makes them a number.

```sh
cave eval examples/eval --runs 3 \
  --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
```

## Fixtures are plain files

A suite is any directory; a case is named by its golden:

```
suite/
  instructions.md               optional, shared by the suite
  family-history.md             the source the agent extracts from
  family-history.golden.cave    the expected extraction
  family-history.queries.cave   optional CAVE-Q behavioral checks
```

For `<stem>.golden.cave` the source is the single sibling `<stem>.<ext>`
(dot-free extension, so other cases' files never masquerade as sources);
zero or several candidates is a reported fixture problem, never a guess.
Instructions resolve nearest-first: `--instructions` beats
`<stem>.instructions.md` beats the case directory's `instructions.md`
beats the suite root's. A single golden file also works as a suite:
`cave eval suite/family-history.golden.cave`.

The queries file holds CAVE-Q patterns, each followed by indented
expectations written exactly as `cave query` prints solutions:

```cave
?a PARENT-OF+ me
  ?a = anna
  ?a = maria
jan HAS birth-year: ?y
  WHERE conf >= 0.6
  ?y = 1932
jan HAS birthplace: Kraków      ; no expectations = the pattern must hold
me PARENT-OF ?child
  none                          ; the pattern must have no matches
```

Listed solutions are an *exact* set — a missing binding fails, and so
does an invented one. Queries are where a fixture asserts usefulness
(multi-hop questions the source only implies) independent of how the
golden spelled each claim; `--aliases` lets agents that declared `ALIAS`
links pass them despite naming drift.

## Reconstruction cases (ROADMAP item 10)

A `<stem>.loop.cave` sibling turns the case into a **reconstruction**
eval of the §18 loop: the source is the *knowledge* (CAVE text), and the
golden is the claims a good reconstruction collects from it. The loop
file is ordinary CAVE about the entity `loop` — no new grammar:

```cave
loop SEEDS reject-valid-tokens          ; initial frontier, file order
loop HAS query: `why are valid tokens rejected?`
loop HAS steps: 12                      ; budgets for both policies
loop HAS claims: 40
```

Without `--agent` the run is the **deterministic heuristic baseline**;
with `--agent` the same seeds and budgets drive `llmPolicy` — the agent
is asked once per step (prompt on stdin, `{prompt-file}` substituted) to
pick the next cue or `STOP`. Scoring is the same claim-key comparison,
so the two runs read like for like:

```sh
cave eval loop-suite/                       # heuristic baseline
cave eval loop-suite/ --agent 'claude -p'   # the LLM policy vs that baseline
```

Query expectations run against **the reconstruction**, not the
knowledge — they assert what the collected claims alone can answer. Loop
fixtures self-check harder: seeds must appear in the knowledge, and
every golden claim must exist in the knowledge (the loop selects claims;
it cannot invent them). The run note records the expansion path.

## How a case runs

Per case, `--runs` times: open a **fresh throwaway store**, drive the
agent over the source through `@cavelang/ingest` (identical prompts and
`--agent` contract to `cave ingest`, mcp and `--stdout` modes alike),
score the store against the golden, run the queries. Fresh stores keep
runs independent, so N runs measure extraction *variance*. Before any
agent run, the fixture self-checks: the golden must parse cleanly and
satisfy its own queries in a scratch store — a broken ruler measures
nothing, and broken fixtures are skipped before agent money is spent.

## Scoring

Both sides run through the same pipeline: canonicalize → strip **actor
stamps** (`@src:cli`, `@src:agent/<name>`, `@src:ingest` —
spec §9.5; which surface wrote a claim must not move its key) → re-key →
last claim per key. Content sources the fixture author wrote
(`@src:maria`) stay part of claim identity, and inverse-direction writes
score against primary-direction goldens for free (one key per fact,
spec §5.5).

A golden claim **matches** when its normalized key is produced and the
value agrees — numerically within `--tolerance` (relative, units must
agree, `~` is metadata), exact text otherwise; relations and existence
claims are decided by the key alone. Reported per run: precision, recall
and F1 over matches, plus `value-off` (right fact, wrong value), the
missed golden claims and the extra produced ones. Confidence, tags,
`+/-` uncertainty and comments are metadata, never scored.

**The judge** (`--judge`, optional) closes the naming-drift gap without
loosening the metric: unmatched golden × produced claims go to a second
agent that pairs the ones stating the same fact (JSON `[G, P]` pairs;
prompt on stdin/`{prompt-file}`). Judged pairs produce a second *judged*
F1 alongside the strict one — `--min` gates on judged F1 when a judge
ran, and on the query pass rate always. Exit status is 1 on fixture
problems, failed agent runs, or an unmet `--min`.

## Recipes

```sh
# Claude Code (headless), full MCP engine per throwaway store
cave eval suite/ --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'

# any command that prints CAVE text
cave eval suite/ --stdout --agent 'llm -m your-model' --runs 5

# gate a prompt change in CI: judged F1 and query rate must hold 90%
cave eval suite/ --stdout --agent your-agent --judge 'claude -p' --min 90% --json

# keep the per-run stores for inspection
cave eval suite/ --stdout --agent your-agent --keep
```

Library API — agents and judges may be functions (an eval-mode agent
additionally receives the run's throwaway `{ db, store }`, so SDK
scripts can write through the engine in mcp mode):

```ts
import { run } from '@cavelang/eval'

const report = await run({
  suites: ['suite/'], mode: 'stdout', runs: 3,
  agent: async prompt => (await anthropic.messages.create({
    model: 'claude-sonnet-5', max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  })).content[0].text,
  judge: async prompt => callYourJudge(prompt)
})
```

## Design decisions

- **Golden + queries, not one or the other.** Claim-key match measures
  fidelity to an expected extraction; query expectations measure whether
  the store *answers questions* regardless of spelling. The first is
  strict and diagnosable, the second is behavioral — an eval needs both
  signals to falsify a prompt change.
- **Actor stamps normalize away; content sources do not** (spec §9.5).
  Golden fixtures written by hand and stores written through mcp, stdout
  ingest or the CLI must key identically; but *which* source a claim
  cites is extraction quality, so the golden decides it.
- **Strict scores never move.** The judge adds a parallel judged score;
  it cannot inflate the strict one, and a broken judge degrades to
  strict scoring with a reported `judgeError`, never a failed run.
- **Fixtures self-check first.** Golden lint problems, empty goldens and
  queries the golden itself cannot answer skip the case before the agent
  runs — eval output must measure the agent, not the fixture.
- **Fresh store per run, `@cavelang/ingest` underneath.** One agent
  contract everywhere (`{prompt-file}`, `{mcp-config}`, `{db}`, stdin
  prompt), and no state leaks between runs or cases; the orchestrator's
  own `ingest-digest` bookkeeping is excluded from scoring.
- **The baseline is a run, not a footnote** (item 10). Reconstruction
  cases without an agent run the heuristic policy through the same
  scoring, so "does the LLM policy beat the heuristic" is two commands
  whose reports differ only in the policy — and `--agent` being optional
  means extraction cases without one fail loudly per run instead of
  being rejected up front.

## Tests

```
pnpm --filter @cavelang/eval test
```

Suite discovery (sources, dotted stems, loop siblings, instructions
precedence), the queries format end to end, scoring normalization (actor
stamps, inverse writes, belief series, value tolerance), judge
prompt/reply parsing, and full runs with function and shell agents:
perfect and lossy extractions, run independence and failure accounting,
judge upgrades, fixture self-check skips, `--keep`, the `cave eval`
argument surface, and reconstruction cases — spec parsing, seed and
reachability self-checks, the heuristic baseline, an LLM-policy run
answering queries from the reconstruction alone, and loop-agent failure
accounting.
