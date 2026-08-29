# Examples

Each directory is a set of runnable fixtures with the commands that use them.
All outputs shown here and in the [root README](../README.md) tutorials were
captured from actual runs; `pnpm install` at the repository root puts `cave`
on the path.

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

The same loop runs interactively over any store:
`pnpm exec cave reconstruct --db incident.db checkout/errors --trace`
(add `--agent 'claude -p' --query '…'` for model-driven selection).

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
