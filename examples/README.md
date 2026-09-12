# Examples

Each directory is a set of runnable fixtures with the commands that use them.
All outputs shown here and in the [root README](../README.md) tutorials were
captured from actual runs.

## Choose a starting point

| What you want to do | Start here | What you need |
| --- | --- | --- |
| Learn claims, graph queries and confidence | [Monorepo tutorial](../README.md#tutorial-i--a-monorepo-one-claim-at-a-time) | The CAVE CLI; no LLM agent |
| Turn CSV or JSON into maintained claims | [Structured data](../packages/connect/README.md) and the monorepo CSV fixture | A source file and mapping template; no LLM agent |
| Extract claims from documents and react to changes | [Market tutorial](../README.md#tutorial-ii--a-market-watchlist) | The CLI and a configured agent for the ingestion steps |
| Explore competing explanations for an incident | [Incident walkthrough](#incident) | The CAVE CLI; no LLM agent |
| Measure extraction or reconstruction quality | [Extraction eval](#eval) or [reconstruction eval](#loop-eval) | The CLI; deterministic examples are included, with an agent for model comparisons |
| Follow one example across the whole system | [Family-history tour](family-history/README.md) | The CLI; agent and optional Z3 setup are introduced where used |

## Run the fixtures

From a repository checkout, follow the [development setup](../README.md#development),
then use `pnpm exec cave` to run the workspace CLI. A local `pnpm install` does
not add `cave` to your shell's global path. The root tutorials use plain `cave`
after the [global installation](../README.md#install); when using the checkout,
replace that command with `pnpm exec cave` and follow each tutorial's working-directory
instructions. Relative source paths and the default `cave.db` belong to that
working directory.

The commands below use repository-root paths unless stated otherwise. Agent
examples such as `--agent 'claude -p'` require that executable to be installed
and configured separately; installing CAVE does not configure an LLM provider.
The extraction eval's golden-output command and the reconstruction eval's
heuristic baseline can both run without a model.

## [`monorepo/`](monorepo) — Tutorial I

The root README's first tutorial: a package graph built one idea per step —
claims, inverse and transitive queries, attributes and tags, your own verbs,
`cave connect` over a CSV, sources and confidence, a rule with lineage,
`EXPECTS` shapes, and a cited report.

## [`market/`](market) — Tutorial II

The second tutorial: fictional companies and the themes that move them, news
articles read by an LLM through `cave ingest`, sign-aware rules that derive
per-company pressure, valid-time trajectories, governed actions, an
automation that fires when bad news reaches an overweight name, and the
morning brief.

## [`family-history/`](family-history) — the full tour

A natural-language document paired with its hand extraction
into CAVE, then pushed through every surface the engine has: transitive ancestor derivation, competing claims about a
disputed birth year, resolution, sensitivity and backups, valid time, MCP and
Copilot, LLM ingestion, rules, actions, connect, evals, alias discovery,
reconstruction, sync, automations, `cave serve`, cited reports, and the
optional solver — [`family-history/README.md`](family-history/README.md).

## [`eval/`](eval)

The family-history extraction as a golden eval fixture:
`family-history.golden.cave` is the expected extraction of
`family-history.md`, and `family-history.queries.cave` asserts the
multi-hop questions the built store must answer — whatever the agent
names things. Score any agent, N times:

```sh
pnpm exec cave eval examples/eval --runs 3 \
  --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
```

(A deterministic dry run of the harness itself: `pnpm exec cave eval
examples/eval --stdout --agent 'cat family-history.golden.cave'` — the
"agent" reads the golden back, scoring F1 100% with every query green.)

## [`loop-eval/`](loop-eval)

The incident knowledge as a *reconstruction* fixture (spec §18):
`postmortem.loop.cave` seeds the loop at the symptom
(`loop SEEDS checkout/errors`, plus a query and a step budget),
`postmortem.golden.cave` is what a good reconstruction collects — the
causal chain and the fix, not the unrelated billing thread — and the
queries must be answered by the reconstruction alone.

```sh
# the deterministic heuristic baseline — no agent, no tokens
pnpm exec cave eval examples/loop-eval
#   postmortem: 4 golden claim(s), 2 query(ies), reconstruction over postmortem.cave
#     run 1/1: 4 claim(s) — 4 matched; P 100% R 100% F1 100%; queries 2/2

# the LLM policy: the agent picks each expansion (or STOP), one prompt per step
pnpm exec cave eval examples/loop-eval --runs 3 --agent 'claude -p'
```

Run the same loop directly over its checked-in knowledge fixture, without first
creating a database:

```sh
pnpm exec cave reconstruct --db examples/loop-eval/postmortem.cave checkout/errors \
  --query "what caused Friday's checkout errors, and what fixed them?" --steps 6 --trace
```

This uses the evaluation fixture's seed, query and step budget. Add
`--agent 'claude -p'` for model-driven selection, or replace the text-file path
with an existing CAVE database to reconstruct from your own store.

## [`incident/`](incident)

A production-incident postmortem: a service dependency chain, competing
root-cause hypotheses, and a rollback.

```sh
pnpm exec cave add --db incident.db examples/incident/incident.cave

# who is transitively exposed to the flaky cache? (no line states it)
pnpm exec cave query --db incident.db '?svc USES+ redis-cache'
#   ?svc = auth/gateway
#   ?svc = checkout
#   ?svc = payments

# which root causes do we actually believe?
pnpm exec cave query --db incident.db '?cause CAUSE checkout/errors' 'WHERE conf >= 0.7'
#   ?cause = redis-cache/failover

# CDN logs came back clean — belief evolves by appending
echo 'cdn CAUSE checkout/errors @ 5% ; ruled out, CDN logs clean' \
  | pnpm exec cave add --db incident.db

# read the same stored rows from the other end (USES REVERSE USED-BY)
pnpm exec cave query --db incident.db 'redis-cache USED-BY ?x'
#   ?x = auth/gateway
```
