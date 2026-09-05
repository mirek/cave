#import "../style.typ": note, file, recap

= Reconstruction

A query answers the question you knew to ask. Sometimes you only have a
symptom. `cave reconstruct` starts from an entity, walks the graph outward
along forward and reverse edges, and collects related claims until a budget
runs out. It is the *agent layer*: a policy over the graph, not part of the
language, and deliberately kept outside the specification.

== A symptom

Customers at the harbour cafe say the morning blend tastes flat. Record what
is known and suspected:

#file("tasting.cave")
```cave
; the July cupping: what we tasted, and what we think explains it

flat-taste EXISTS @cafe/harbour @ 90% ; two complaints in a week
stale-lot CAUSE flat-taste @ 50%
grinder/harbour CAUSE flat-taste @ 30%
water/harbour CAUSE flat-taste @ 20%
lot/huila-26 IS stale-lot @ 60% ; roasted a month ago
lot/huila-26 HAS roast-date: 2026-07-30
grinder/harbour HAS burr-age: 14mo
burr-swap FIX flat-taste @ 40%
cafe/harbour HAS manager: "Sam"
```

```sh
$ cave add --db roastery.db roastery.cave tasting.cave
added 42 claim(s), 0 edge(s)

$ cave reconstruct --db roastery.db flat-taste --steps 4 --trace
; 1. flat-taste @ 1.00 +5 claim(s)
; 2. stale-lot @ 0.40 +1 claim(s)
; 3. burr-swap @ 0.32 +0 claim(s)
; 4. grinder/harbour @ 0.24 +1 claim(s)

flat-taste EXISTS @cafe/harbour @src:cli @ 90% ; two complaints in a week
stale-lot CAUSE flat-taste @src:cli @ 50%
grinder/harbour CAUSE flat-taste @src:cli @ 30%
water/harbour CAUSE flat-taste @src:cli @ 20%
burr-swap FIX flat-taste @src:cli @ 40%
lot/huila-26 IS stale-lot @src:cli @ 60% ; roasted a month ago
grinder/harbour HAS burr-age: 14mo @src:cli
```

The trace lines are comments, so the output is valid CAVE that can be piped
into another store. Starting from the symptom, the walk collected the three
hypotheses and the proposed fix, then expanded the strongest hypothesis and
found the stale lot, then the grinder and its burr age. With four steps it
did not reach the cafe's manager or the lot's price, which is the point:
reconstruction is about what is *related*, ranked, not everything reachable.

== The policy

At each step the loop has a frontier of entities it could expand next, and
it scores them by relation direction, confidence, recency, and novelty. The
deterministic heuristic picks the highest score. `--steps` bounds the
number of expansions, `--claims` stops after enough claims are collected,
and `--trace` shows every choice with its score.

With `--agent`, a language model makes the select-or-stop decision instead.
Each step sends one prompt containing the question, the claims collected so
far as canonical CAVE, and the scored frontier; the model replies with the
name of the cue to expand or `STOP`. Scoring stays local arithmetic, and an
unparseable reply degrades to the strongest cue rather than ending the
walk:

// no-test
```sh
$ cave reconstruct --db roastery.db flat-taste \
    --query 'why does the morning blend taste flat at the harbour cafe?' \
    --agent 'claude -p'
```

The heuristic is not a fallback; it is the baseline. Reconstruction
fixtures in `cave eval` (Chapter 16) score both policies with the same
claim-key F1, so "the model retrieves better memory" is a claim you can
test with two commands.

== Why not a vector search

Reconstruction follows explicit, typed relations, in both directions,
through the reverse names the vocabulary declared. It returns the source
claims themselves, not summaries, and it exposes the path that brought each
claim into context. A similarity search over embeddings finds text that
sounds like the question; a walk over a claim graph finds what the store
believes is connected to it, with the confidence of every hop visible.

The same loop is served to agents as the MCP `cave_reconstruct` tool, and
`cave demo` narrates a small multi-hop recovery on an in-memory store.

#recap[`cave reconstruct <seed>` walks forward and reverse edges best-first
from a cue, collecting related claims as canonical CAVE text; `--trace`
shows the path and scores, `--steps` and `--claims` bound it. The
deterministic heuristic is the baseline; `--agent` lets a model choose each
expansion, and `cave eval` scores both the same way.]
