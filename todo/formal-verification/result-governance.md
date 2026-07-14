---
name: formal-verification-result-governance
description: Keep solver artifacts, recommendations, decisions, and actions distinct.
status: open
priority: low
area: governance
source: solver-feasibility-analysis
---

# Govern result recording

## Goal

Make ephemeral evaluation the default and require an explicit transition before
solver output becomes durable knowledge or drives an external effect.

## Result lifecycle

1. `evaluate` returns a pure artifact and writes nothing.
2. `record` appends a scenario result with its model digest, snapshot, solver,
   inputs, status, and evidence lineage.
3. A recommendation is recorded separately from the scenario result.
4. A human or governed action records the chosen decision.
5. Existing actions validate and execute any external effect.

Do not record `monolith IS best`. Prefer statements scoped to the run, such as
“scenario X recommended monolith under model Y,” while the actual choice is a
separate decision event.

## Confidence and authority

- Solver proof status describes the formal result under a model; it is not
  CAVE confidence in the model's real-world adequacy.
- Forecast probability remains a modeled input, separate from belief
  confidence and soft preference weight.
- Recording does not grant authority to execute an action.
- Replaying an old recorded result never silently re-evaluates it against the
  current store.

## Identity and replay

A recorded artifact includes enough information to detect rather than hide
drift:

- canonical model digest and schema version;
- solver backend/version and relevant options;
- snapshot transaction and valid time;
- exact explicit inputs and source row IDs;
- objective ordering and result status; and
- limits, elapsed time, and unknown reason where relevant.

Re-evaluation creates a new run. It does not mutate the old result.

## Done when

- Evaluation tests prove zero base-store writes.
- Recording is explicit, atomic, and idempotent by run identity.
- Result, recommendation, decision, action, and external effect have separate
  representations.
- Recorded artifacts replay or clearly report incompatible model/solver
  versions.
- MCP permissions distinguish evaluation, recording, and action execution.
