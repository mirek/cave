# Examples

Each directory pairs a natural-language document with its hand extraction
into CAVE, so every command below is copy-paste runnable from the repository
root (after `pnpm install`). All outputs shown here and in the main README
walkthrough were captured from actual runs.

## [`family-history/`](family-history)

The main [README](../README.md#quick-start) walkthrough: notes from a
birthday conversation become a queryable belief graph — transitive
ancestor derivation, competing claims about a disputed birth year,
append-only belief updates, rule-derived grandparenthood with lineage
(`rules.cave`, spec §24), and LLM-driven ingestion of the raw prose
(`instructions.md` steers the agent's domain modeling).

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

The incident knowledge as a *reconstruction* fixture (spec §18,
spec §18): `postmortem.loop.cave` seeds the loop at the symptom
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
