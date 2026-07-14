---
name: value-shape-expectations
description: Extend EXPECTS with unit and cardinality constraints.
status: open
priority: medium
area: shape
source: roadmap
---

# Value-shape expectations

## Problem

`EXPECTS` and `cave check` validate presence only. They cannot express exactly-one ownership or require a value in a compatible unit.

## Direction

Design in-band cardinality and unit expectations without turning the schema layer into a general-purpose type system.

## Done when

- Cardinality and unit semantics are specified.
- `cave check` reports actionable violations.
- Gate behavior and compatibility are covered by tests and docs.
