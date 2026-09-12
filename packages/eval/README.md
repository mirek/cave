# @cavelang/eval

The evals harness for golden-fixture extraction and §18 reconstruction:
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

An explicit `--instructions` path must name an existing file. A missing path or
directory is a fixture error before agent work; it does not fall back to the
suite's instructions.
Golden, query, loop and selected instruction paths must be files. Directories
at those paths are reported as fixture problems; valid sibling cases remain
available to run.

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
does an invented one. Each variable may appear only once per solution line;
repeated variables are fixture errors. Names such as `?__proto__` and
`?constructor` work like other query variables.
Patterns and expectation lines may end with `;`
inline comments; semicolons and binding-like text such as `?x = value` inside
quotes or backticks remain part of the value. Queries are where a fixture asserts usefulness
(multi-hop questions the source only implies) independent of how the
golden spelled each claim; `--aliases` lets agents that declared `ALIAS`
links pass them despite naming drift.

## Reconstruction cases (spec §18)

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

The `steps` and `claims` budgets must be positive safe integers (at most
9,007,199,254,740,991). Invalid budgets are line-numbered fixture errors and
skip the case before policy execution.

Direct `Loop.runSpec` calls check cancellation before reconstruction starts
and before and after each agent completion. A completion failure concurrent
with cancellation retains both errors. Function completions must settle before
the post-completion cancellation check can run.

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

Each evaluation invocation captures its settings once and copies the suite list
before discovering fixtures. Agent, judge, scoring options and cancellation stay
fixed across cases and repeated runs, even if an asynchronous callback mutates
the caller's options. A later invocation captures the caller's current settings.

The run count (`--runs` or `Options.runs`) must be a positive safe integer.
Malformed programmatic run counts and scoring tolerances retain their
option-specific validation messages even when the supplied value cannot be
printed; those descriptions use `[unprintable value]`. Validation precedes
suite discovery, and the same tolerance diagnostic applies to direct scoring.
Invalid counts fail before suite discovery or agent work; the default is one.

Programmatic `Options.mode` accepts `mcp` or `stdout`, defaulting to `mcp`
when omitted. Invalid modes fail before fixture discovery. `--timeout` and
`Options.timeoutSeconds` must resolve to whole milliseconds from 1 through
2,147,483,647 (0.001 through 2147483.647 seconds); the default is 600 seconds.
Invalid timeouts fail before fixture discovery, including for empty suites.
Programmatic timeout values must be numbers; strings, booleans and objects
are rejected without numeric coercion. CLI numeric text is parsed separately.

Per case, `--runs` times: open a **fresh throwaway store**, drive the
agent over the source through `@cavelang/ingest` (identical prompts and
`--agent` contract to `cave ingest`, mcp and `--stdout` modes alike),
score the store against the golden, run the queries. Fresh stores keep
runs independent, so N runs measure extraction *variance*. Before any
agent run, the fixture self-checks: the golden must parse cleanly and
satisfy its own queries in a scratch store — a broken ruler measures
nothing, and broken fixtures are skipped before agent money is spent.
Fixture diagnostics and their text output append iteratively, avoiding
JavaScript's function-argument limit for large invalid inputs. A 130,000-line
invalid golden regression checks every diagnostic, no agent execution, and
successful recovery after correction. Fixtures and diagnostics still reside
in memory; this does not impose a memory budget.
Completed-run text also appends diagnostics iteratively. An extraction may
produce valid claims alongside many parse errors; its retained errors remain
visible in the report instead of causing a formatting failure.
Golden and query files, and reconstruction knowledge and loop specifications,
must contain valid UTF-8. Invalid bytes abort evaluation with the file path
before running that case; they are never replaced to produce a score.

Rejected ingestion batches are scoreable only when marked as partially accepted
stdout output: valid claims beside parse errors still receive extraction scores.
A changed or unreadable source remains a failed run even if a direct agent wrote
claims first. Its source diagnostic is retained in the failed run's note.

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

Tolerance must be a finite number in `[0, 1]`, defaulting to zero (exact
numeric agreement). CLI `--tolerance` and `--min` require a number: empty or
whitespace-only values and a bare `%` are errors; explicit `0` and `0%` are valid.
The library validates tolerance before evaluation starts and in
direct `Score.compare` and `Score.valueAgrees` calls, even for empty comparisons,
so an invalid setting cannot silently affect scores or consume agent work.
Each `Score.compare` call reads its tolerance once and applies that validated
value to every fact. A later comparison can select a different tolerance.
Relative error is computed against the golden magnitude, including for
subnormal numbers; a zero golden value requires an exact numeric match.
Direct comparisons also keep only the last supplied fact for each key on each
side, so duplicate entries cannot inflate match counts or distort scores.

Case and suite precision, recall and F1 are arithmetic means over successful
runs, with each run weighted equally regardless of its claim count. Suite F1
is the mean of run F1 scores, rather than F1 recomputed from the mean precision
and recall. Query pass rate counts passed expectations over all expectations
checked in successful runs. Failed runs are excluded from these averages but
still make the command exit 1; a report with no scored runs cannot pass `--min`,
even when the minimum is zero.

**The judge** (`--judge`, optional) closes the naming-drift gap without
loosening the metric: unmatched golden × produced claims go to a second
agent that pairs the ones stating the same fact (JSON `[G, P]` pairs;
prompt on stdin/`{prompt-file}`). Judged pairs produce a second *judged*
F1 alongside the strict one — `--min` gates on judged F1 when a judge
ran, and on the query pass rate always. Exit status is 1 on fixture
problems, failed agent runs, or an unmet `--min`.

Replies accept an array of pairs or an explicit `{"pairs":[...]}` wrapper.
Complete JSON strings and unrelated object fields are not answers: neither
`"[[1,1]]"` nor `{"rejected":[[1,1]]}` can improve a score. Shared agent-layer
extraction selects the last eligible array, then evaluation validates pair
indices; ordinary prose and unfinished-bracket recovery remain supported.

Judge replies may include prose or code fences around the final JSON array.
The last eligible answer wins; malformed entries and reused or out-of-range
indices are dropped. Brackets inside JSON strings do not alter array boundaries,
and an unfinished outer prose bracket does not hide a balanced answer inside it.
Malformed prose quotes use literal-bracket recovery; strings inside a valid
array remain data and cannot become separate answers.

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

The `runEval` command captures its context's signal once before evaluation and
uses it for the initial abort check, suite execution and final result check.
An initially absent signal stays absent for that command; an initially supplied
signal continues to govern cancellation even if a context getter later returns
a different value. The library `run` likewise captures its options at startup.

Evaluation's `signal` stops subsequent cases, repetitions, reconstruction
completions and judging. With successful cleanup, cancellation rejects with the
original signal reason; it is not recorded as an agent failure or a judge score.
Evaluation attempts to close each throwaway store. It attempts to remove the
temporary root unless `keep` is enabled. The retention decision is captured
at evaluation startup and used for both reported paths and cleanup, even if a
caller changes its options while an agent is running. Function adapters must settle before
cleanup; they can capture the signal to cancel their own asynchronous work.

If removing the evaluation root fails while another exception is propagating,
`run` retains both in an `AggregateError`: the prior exception is first in
`errors` and is the `cause`, followed by the removal exception. The message
includes both diagnostics. A removal-only failure retains its original identity;
`keep: true` skips root removal, including on cancellation. Removal is attempted
once, and a filesystem failure may leave the directory for inspection. This is
the outer evaluation-root contract; individual run stores, fixture scratch stores
and judge prompt directories have separate lifetimes.

Extraction and reconstruction runs also attempt to close their owned store once.
If cancellation or a caught scoring/work exception is followed by a close
failure, both survive in the ordered AggregateError, with the original failure
(or cancellation reason) as cause. A close-only failure retains its identity and
stops further runs. When close succeeds, ordinary caught work exceptions still
produce failed-run reports; cancellation still rejects. Unprintable scoring or
run errors use `[unprintable thrown value]` in the note rather than aborting
report construction. The run report remains JSON-serializable, and normal
owned-store and directory cleanup still follows. Root removal follows the
captured keep policy even after close fails, and an additional root-removal error
retains the earlier aggregate. This preserves thrown work errors; agent or judge
failures already represented solely as report values retain their existing report
semantics.

Query execution errors remain individual failed expectations. If a thrown value
cannot be printed, its error is `[unprintable thrown value]`; later expectations
can still run and the outcomes remain JSON-serializable.

Shell judges attempt to remove their prompt directory once. A pending write or
cancellation exception plus removal failure retains both diagnostics using the
same ordered AggregateError contract. Without cancellation, caught exceptions
still become failed-run notes. Cancellation checks preserve an existing exception
that contains the cancellation reason through its cause or aggregate members;
they do not replace it with the bare reason. A distinct work exception arriving
with cancellation is combined with the reason first and as cause. This also
preserves cleanup diagnostics propagated by ingestion into evaluation.
Error messages that cannot be read or converted use `[unprintable thrown value]`
without replacing original failures. Cancellation traversal captures each cause
once and treats unreadable cause or aggregate metadata as unknown. Unless a
readable branch contains the reason, cancellation and the original work error
are retained together. Cleanup attempts still run when diagnostics are opaque.

Fixture query validation owns an in-memory scratch store and attempts to close
it once after checking the golden claims. A pending fixture exception plus a
scratch-close failure uses the same ordered AggregateError contract; subsequent
root-removal failure wraps that earlier aggregate, retaining the diagnostic
chain. Single failures keep their original identity. A thrown preflight failure
stops evaluation before agent calls. Ordinary query mismatches remain fixture
problems, rather than becoming exceptions merely because they do not match.

Library API — agents and judges may be functions (an eval-mode agent
additionally receives the run's throwaway `{ db, store }`, so SDK
scripts can write through the engine in mcp mode):

```ts
import { run } from '@cavelang/cli/eval'

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
  When actor stamps distinguish stored belief series, scoring merges those
  series by normalized key and uses the latest transaction's value. It keeps
  different content sources separate and leaves stored history and provenance
  intact. An authored source normally suppresses a compatibility actor stamp;
  lifecycle ownership retains both stamps. Both modes follow the same scoring
  rules.
- **Strict scores never move.** The judge adds a parallel judged score;
  it cannot inflate the strict one, and a broken judge degrades to
  strict scoring with a reported `judgeError`, never a failed run.
  Shell agents and judges reject malformed captured UTF-8 stdout before parsing
  claims or scores. Agent output is rejected; a judge failure follows the same
  strict-score fallback with `judgeError`.
- **Fixtures self-check first.** Golden lint problems, empty goldens and
  queries the golden itself cannot answer skip the case before the agent
  runs — eval output must measure the agent, not the fixture.
  Query self-check failures identify the query line and report missing or
  unexpected bindings; a bare query with no answers reports `no matches`.
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

## Judge parser scaling profile

`pnpm bench:judge-parse` measures three isolated samples of balanced malformed
nested arrays followed by a valid final answer, asserting the recovered pair.
On Node 26.5.0 / macOS arm64, the original parser repeatedly decoded overlapping
invalid spans. The shared agent-layer `jsonValueEnds` reverse syntax index
validates JSON value boundaries and
shares array/object suffixes before native JSON decoding. Both indexing and the
total decoded span length are linear in reply length; indexing uses proportional
memory. Existing prose, quote and bracket recovery still selects the candidates,
and complete JSON containers consume their span before nested candidates.

| Nesting depth | Reply bytes | Before | With syntax index |
|---|---:|---:|---:|
| 1,000 | 2,015 | 13.1 ms | 0.65 ms |
| 2,000 | 4,015 | 41.8 ms | 0.36 ms |
| 4,000 | 8,015 | 146.4 ms | 1.09 ms |
| 8,000 | 16,015 | 538.1 ms | 1.67 ms |

These short three-sample medians include runtime warm-up variation and measure
parsing alone, not judge latency. Deep valid/malformed nesting and damaged JSON
regressions check syntax against native JSON parsing and verify that invalid
nesting is never passed repeatedly to the decoder. No truncation or parse-attempt
budget changes which final answers remain eligible.
