---
name: trajectory-arrow-highlighting
description: Capture the trajectory arrow as an operator.
status: open
priority: low
area: grammar
source: implementation-audit
---

# Trajectory arrow highlighting

## Problem

The `->` token in a trajectory has no highlight capture in terminal or VS Code rendering.

## Direction

Add the trajectory arrow to `highlights.scm` as an operator.

## Done when

- `->` receives the operator capture in query tests.
- Terminal and VS Code fixtures render the same capture.
