---
name: formal-verification-workflows
description: Expose bounded feasibility, optimization, counterexample, and sensitivity operations.
status: completed
priority: low
area: reasoning
source: solver-feasibility-analysis
---

# Add verification workflows

## Goal

Expose a small set of named computations over stored models and typed scenario
inputs. Keep the operations semantically distinct even when one backend
implements all of them.

## Operations

### Feasibility

Find one assignment satisfying all hard constraints, or explain that the
selected constraints are inconsistent. Support deterministic tie-breaking so
replay does not depend on an arbitrary backend model.

### Optimization

Optimize explicitly ordered objectives over feasible assignments. Return
whether optimality was proved, the objective values, and any available bound.
Never treat a merely feasible result as optimal after a timeout.

### Counterexample

Negate a declared invariant and search for a satisfying assignment. A model is
a concrete counterexample; unsatisfied means the invariant holds only within
the bounded model and declared theories.

### Sensitivity and counterfactuals

Fix an option or vary one typed input across a bounded domain to find where
feasibility or the preferred assignment changes. Reuse incremental solving
only behind the adapter so public semantics do not depend on Z3 push/pop.

## Surface

Start with a TypeScript API and CLI fixture. Add MCP only after models are
named, validated, bounded, and selectable from an allowlist. Agents supply a
model name plus typed inputs; they do not supply raw SMT-LIB or arbitrary
expressions.

Actions remain the authority boundary. A solver can propose parameters for an
action, but the existing action engine rechecks preconditions and performs the
governed write.

## Done when

- The four operations share one model, snapshot, limits, and result vocabulary.
- Deterministic tie-breaking is documented and tested.
- Counterexample reports state the finite domains and assumptions they cover.
- Sensitivity runs are bounded and surface discontinuities and unknown regions.
- CLI and eventual MCP surfaces cannot bypass model validation or resource
  limits.
- Proposed action parameters are revalidated by the action engine before use.

## Outcome

Implemented in `@cavelang/solver` as the versioned
`cave.solver/workflow@1` API. Feasibility, optimization, counterexample, and
bounded sensitivity share the portable model, snapshot explanation context,
adapter limits, and disjoint result vocabulary. Stable variable-ID ordering
provides deterministic Boolean, numeric, and enum tie-breaking; sensitivity
reports adjacent transitions and contiguous unknown regions without
interpolating across timeouts.

`@cavelang/solver-z3` ships the separate allowlisted
`cave-solver-workflow architecture` fixture, which accepts bounded typed flags
but no raw models or SMT-LIB. Solver recommendations remain non-authoritative:
`@cavelang/act` routes `actProposal` through current parameter, premise, shape,
transaction, and hook checks before any write.
