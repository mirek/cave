---
name: decision-scenario-layer
description: Support ephemeral overlays and typed external evaluation.
status: open
priority: low
area: product
source: architecture-review
---

# Decision and scenario layer

## Problem

Exploring a hypothetical currently risks mixing assumptions with durable facts or requires ad hoc branching and application glue.

## Direction

Design ephemeral overlays with typed inputs and an external evaluator, keeping agents and executable policy outside the core language.

The first evaluator can remain ordinary deterministic TypeScript. Models that
need feasibility search, optimization, or counterexamples should use the
separate [formal verification and constraint solving](formal-verification.md)
layer through the same typed scenario boundary.

## Done when

- Scenarios cannot mutate the base store implicitly.
- Inputs, outputs, provenance, and promotion-to-fact are explicit.
- External evaluators share one versioned input and result contract.
- A concrete decision workflow proves the layer useful.
