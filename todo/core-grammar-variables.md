---
name: core-grammar-variables
description: Decide whether query variables belong in the core grammar.
status: open
priority: low
area: language
source: draft-spec-17.1
---

# Core grammar variables

## Problem

CAVE-Q implements `?x` variables, while the core-language variable draft remains gated and unproven.

## Direction

Add core variables only when a non-query use case demands shared syntax and semantics.

## Done when

- A concrete use case cannot be handled cleanly by CAVE-Q.
- Binding, scope, serialization, and compatibility are specified.
- Both parsers and all emitters agree.
