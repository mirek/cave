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

`@cavelang/scenario` now keeps hypothetical claims inside rolled-back
savepoints and returns typed, versioned, evidence-backed input records. The
remaining gap is the shared result/promotion contract and a concrete ordinary
decision workflow beyond solver-input binding.

## Direction

Design ephemeral overlays with typed inputs and an external evaluator, keeping agents and executable policy outside the core language.

The first evaluator can remain ordinary deterministic TypeScript. Models that
need feasibility search, optimization, or counterexamples should use the
separate [formal verification and constraint solving](formal-verification.md)
layer through the same typed scenario boundary.

## Progress

Typed snapshot selection, explicit cardinality/conflict policies, exact unit
conversion, stable belief/scenario evidence IDs, replay digests, and
post-rollback evaluator execution are shipped in `@cavelang/scenario`.
Solver explanations consume the same input record through
`explanationContext`; durable recommendation and promotion semantics remain
open.

## Done when

- Scenarios cannot mutate the base store implicitly.
- Inputs, outputs, provenance, and promotion-to-fact are explicit.
- External evaluators share one versioned input and result contract.
- A concrete decision workflow proves the layer useful.
