---
name: formal-verification-explanations-provenance
description: Map constraints, objectives, models, and cores back to CAVE evidence.
status: completed
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

## Outcome

Implemented in `@cavelang/solver` as portable provenance fields plus the
versioned `cave.solver/explanation@1` report. `Solve.runWithExplanation` maps
assignments, exact objective values, evaluated hard/soft constraints, mapped
non-minimal unsatisfiable cores, and structured unknown reasons to model
declarations, CAVE row IDs, and scenario input IDs. `Explain.render` provides a
deterministic human view over the same JSON data without persisting anything.

`@cavelang/scenario` supplies `explanationContext`, retaining the frozen
transaction/valid-time snapshot, binding queries, typed and authored values,
input/overlay digests, and exact belief or rolled-back scenario evidence. The
canonical model digest is checked at the explanation boundary, so replaying a
record against a different model fails explicitly.
