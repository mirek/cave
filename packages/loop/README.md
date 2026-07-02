# @cave/loop

`cave-loop` — the active-reconstruction agent layer over the CAVE graph
(spec §18, **non-normative**). Implements Ji et al.'s Algorithm 1
(*Memory is Reconstructed, Not Retrieved*, 2026) as a functional loop, per
the spec's Cue–Tag–Content mapping (§11.3).

The agent layer is deliberately outside the language specification:
reconstruction is a *policy* over the graph, so the policy can evolve or
be swapped without spec churn. Everything here is injectable.

```ts
import { memoryStoreOfText, reconstruct, heuristicPolicy } from '@cave/loop'

const store = memoryStoreOfText(knowledge)
const { claims, trace } = reconstruct(store, heuristicPolicy(), ['reject-valid-tokens'])
```

## Pieces

- **`CaveStore`** — the store contract the language guarantees the agent
  (§18): forward reads via the subject index, *named* inverse reads via
  the object index plus `inverse_of()`, current-belief resolution via
  claim keys, topic expansion via `CONTAINS` in both directions.
  `memoryStore` implements it dependency-free (and mirrors `@cave/store`'s
  traversal defaults: negated and `@ 0%` facts are not edges).
- **`Policy`** — select / score / stop, injected into `reconstruct`. The
  loop routes by expanding a cue's claims (content) and offering scored
  neighbors from forward, inverse and topic edges.
- **`heuristicPolicy`** — deterministic greedy best-first: score = parent
  score × edge confidence × decay, with step/claim budgets and a score
  floor. Same inputs, same reconstruction — used by the tests.
- **`llm.ts`** — a commented adapter sketch (`AsyncPolicy`, `Complete`)
  for the eventual LLM-driven policy: the model decides select/stop over
  claims rendered as canonical CAVE text; the loop stays unchanged.

## Demo

```
pnpm --filter @cave/loop demo
```

The multi-hop recovery pattern central to the paper's thesis: starting
from the *symptom* cue `reject-valid-tokens`, the loop crosses two edges
that only exist as inverse reads (`CAUSED-BY`, then `PART-OF` — the exact
gap `REVERSE` closes) into the `topic/auth-hardening` cluster, expands it,
and surfaces the bug claim and its fix — without wandering into unrelated
knowledge.

## Tests

```
pnpm --filter @cave/loop test
```
