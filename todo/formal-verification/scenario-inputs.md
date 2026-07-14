---
name: formal-verification-scenario-inputs
description: Bind typed CAVE snapshots and ephemeral assumptions into solver models.
status: open
priority: low
area: reasoning
source: solver-feasibility-analysis
---

# Bind typed scenario inputs

## Goal

Turn an explicit belief snapshot plus hypothetical inputs into pure model data
without leaving assumptions in the base store.

## Snapshot contract

A run selects transaction time, valid time, alias handling, resolution mode,
and minimum confidence using the existing query semantics. Every input binding
declares:

- its CAVE-Q pattern;
- expected type and unit;
- cardinality (`one`, `optional`, or `many`);
- whether scenario input may override the stored value;
- the reduction policy for `many`; and
- behavior for missing, contested, retracted, or unresolved beliefs.

No implicit “first match” or latest-row rule may exist outside the selected
query options.

## Overlay lifecycle

1. Open a store transaction or isolated temporary store.
2. Apply validated scenario claims with a scenario-specific source.
3. Run every input query and retain values plus exact supporting row IDs.
4. Materialize a pure input record.
5. Roll back the overlay and restore registry state.
6. Compile and solve outside the database transaction.

The implementation must not hold a SQLite transaction open while awaiting a
Wasm worker. A timeout or worker crash must therefore be unable to leak an
overlay.

## Numeric and unit behavior

- Reject incompatible units before compilation.
- Preserve the authored exact decimal representation where possible.
- Require an explicit conversion table before converting compatible units.
- Keep approximation, uncertainty, confidence, and the selected scalar value
  separately available to model policy.
- Do not convert uncertainty or confidence into soft weights automatically.

## Done when

- Base and scenario values are distinguishable in the input record.
- Rollback tests cover successful, invalid, timed-out, and crashed evaluations.
- Ambiguous cardinality and incompatible units produce actionable diagnostics.
- Snapshot options and all supporting row IDs appear in the run metadata.
- Replaying the same snapshot, overlay, and model yields the same compiled
  input record.
