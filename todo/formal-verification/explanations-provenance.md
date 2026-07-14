---
name: formal-verification-explanations-provenance
description: Map constraints, objectives, models, and cores back to CAVE evidence.
status: open
priority: low
area: provenance
source: solver-feasibility-analysis
---

# Map explanations to provenance

## Goal

Make solver output inspectable in CAVE terms. A model without evidence is an
opaque answer; a constraint core without human labels is an opaque failure.

## Provenance model

Each compiled input, constraint, and objective carries:

- a stable local identifier;
- the model declaration or file location that created it;
- exact supporting claim row IDs where applicable;
- scenario input names and authored values;
- the query and snapshot options used to bind it; and
- a human description that is not used as identity.

The run itself records a canonical model digest, solver/version, snapshot
transaction boundary, valid-time selection, explicit inputs, limits, and final
status.

## Explanations

For a feasible or optimal result, report:

- chosen assignments;
- satisfied hard constraints relevant to the choice;
- soft constraints accepted and violated;
- per-objective contributions where the model can calculate them; and
- proof status or best-known bound.

For an unsatisfied result, map the backend core to constraint descriptions,
source claims, and scenario inputs. State that a core need not be minimal. A
separate bounded minimization pass may shrink small cores, but explanation must
not make solve success depend on finding a globally minimal core.

For `unknown`, report the structured reason and never render it as evidence
that no solution exists.

## CAVE lineage

Ephemeral output may present `BECAUSE`/`VIA`-like structure without inserting
edges. If a result is explicitly recorded, its durable artifact can link to
the exact evidence rows and model declaration using ordinary CAVE lineage.
Historical or synced evidence IDs must retain their global identity.

## Done when

- Every output value can identify the model element that produced it.
- An unsat-core report links to exact CAVE rows and scenario inputs.
- Explanations remain valid after unrelated store appends because the snapshot
  and row IDs are recorded.
- Human labels can change without changing model identity.
- Snapshot, model, and solver metadata appear in JSON and human reports.
