#import "../style.typ": note, file, recap

= Measuring an Extraction

Is the new prompt better than the old one? Does this model name things
consistently? Questions like these stay anecdotal until there is a number.
`cave eval` turns a source, its expected extraction, and a few questions
into a score that any agent can be run against, as many times as you like.

== A fixture

A case is a golden file with its source beside it. The golden is the
extraction you would accept; an optional queries file lists patterns the
built store must answer, however the agent chose to name things:

#file("evals/roastery.md")
```md
Call with Ana at La Cima, 12 August.

The Huila lot is being re-priced to 8.20 USD/kg from September; the
contract is indexed, so expect 8.60 by next year. Ana thinks the
Tolima lot will cup around 85 but the sample is not in yet. La Cima is
now certified organic (paperwork attached).
```

#file("evals/roastery.golden.cave")
```cave
lot/huila-26 HAS price: 8.20 USD/kg @2026-09..
lot/tolima-26 HAS score: ~85 @ 50%
la-cima HAS certification: organic
```

#file("evals/roastery.queries.cave")
```cave
; what the built store must answer, written as cave query prints it
la-cima HAS certification: ?c
  ?c = organic

; the hedged score must not pass a confidence filter
lot/tolima-26 HAS score: ?s
  WHERE conf >= 0.8
  none
```

== Scoring

The agent extracts each source into a fresh throwaway store, and the result
is scored against the golden by claim key and value. Actor stamps are
ignored, so it does not matter whether the agent wrote through MCP or
stdout, and a claim written in the inverse direction matches for free. A
`cat` of the golden is the trivially perfect agent, which is a good way to
check that a fixture is consistent with itself:

```sh
$ cave eval evals --stdout --agent 'cat roastery.golden.cave'
eval: 1 case(s), 1 run(s) each
evals/roastery: 3 golden claim(s), 2 query(ies), source roastery.md
  run 1/1: 3 claim(s) — 3 matched; P 100% R 100% F1 100%; queries 2/2
suite: P 100% R 100% F1 100%; queries 100%
```

Now simulate the naming drift real extractions suffer, with an agent that
capitalizes the supplier:

```sh
$ cave eval evals --stdout --agent 'sed "s/la-cima/La-Cima/" roastery.golden.cave'
eval: 1 case(s), 1 run(s) each
evals/roastery: 3 golden claim(s), 2 query(ies), source roastery.md
  run 1/1: 3 claim(s) — 2 matched; P 67% R 67% F1 67%; queries 1/2
    miss: la-cima HAS certification: organic
    extra: La-Cima HAS certification: organic
    query failed: la-cima HAS certification: ?c
      missing ?c = organic
suite: P 67% R 67% F1 67%; queries 50%
```

Precision, recall, and F1 are reported per run and for the suite, with the
misses, extras, and failed bindings diagnosed so the cause is visible. The
agent command runs with the case directory as its working directory, which
is why `cat roastery.golden.cave` works.

== Making it a gate

`--runs 3` runs every case three times to measure variance. `--min 90%`
exits 1 unless the mean F1 and the query pass rate reach the threshold,
which is all it takes to put an extraction prompt under continuous
integration. `--tolerance 5%` accepts numeric values within a relative
band. `--judge '<command>'` runs a second agent over the leftovers after
strict scoring, pairing claims that are semantically equivalent despite
naming drift into a separate *judged* F1 that never replaces the strict
one. Point a real agent at the suite exactly as you would at `cave ingest`:

// no-test
```sh
$ cave eval evals --runs 3 --min 90% \
    --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
```

== Scoring a reconstruction

The same harness scores memory *reconstruction* (Chapter 20). A case whose
stem has a `.loop.cave` sibling is a reconstruction eval: the source is the
knowledge, the loop file declares where to start and how far to walk, and
the golden is what a good walk should collect.

#file("loop/flat-taste.cave")
```cave
flat-taste EXISTS @cafe/harbour @ 90%
stale-lot CAUSE flat-taste @ 50%
grinder/harbour CAUSE flat-taste @ 30%
lot/huila-26 IS stale-lot @ 60%
burr-swap FIX flat-taste @ 40%
cafe/harbour HAS manager: "Sam"
cafe/harbour STOCKS coffee/morning-blend
```

#file("loop/flat-taste.golden.cave")
```cave
stale-lot CAUSE flat-taste @ 50%
grinder/harbour CAUSE flat-taste @ 30%
lot/huila-26 IS stale-lot @ 60%
burr-swap FIX flat-taste @ 40%
```

#file("loop/flat-taste.loop.cave")
```cave
loop SEEDS flat-taste
loop HAS query: `why does the morning blend taste flat at the harbour cafe?`
loop HAS steps: 3
```

Without an agent the deterministic heuristic policy runs, which is the
baseline every model-driven policy is measured against:

```sh
$ cave eval loop
eval: 1 case(s), 1 run(s) each
loop/flat-taste: 4 golden claim(s), reconstruction over flat-taste.cave
  run 1/1: 5 claim(s) — 4 matched; P 80% R 100% F1 89%
    extra: flat-taste EXISTS @cafe/harbour @ 90%
suite: P 80% R 100% F1 89%
```

With `--agent`, the model picks each expansion instead, and "does the model
beat the heuristic" becomes two runs of the same command.

#recap[A case is `<stem>.golden.cave` beside its source, plus optional
`<stem>.queries.cave` expectations. `cave eval <suite> --agent '<command>'`
scores claim-key F1 and query pass rate per run; `--runs`, `--tolerance`,
`--judge`, and `--min` make it a CI gate. A `.loop.cave` sibling scores a
reconstruction instead, with the heuristic as baseline.]
