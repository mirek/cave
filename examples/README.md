# Examples

Each directory pairs a natural-language document with its hand extraction
to CAVE, so every command below is copy-paste runnable from the repository
root (after `pnpm install`). All outputs shown here and in the main README
walkthrough were captured from actual runs.

## [`family-history/`](family-history)

The main [README](../README.md#quick-start) walkthrough: notes from a
birthday conversation become a queryable belief graph — transitive
ancestor derivation, competing claims about a disputed birth year,
append-only belief updates, rule-derived grandparenthood with lineage
(`rules.cave`, spec §24), and LLM-driven ingestion of the raw prose
(`instructions.md` steers the agent's domain modeling).

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
