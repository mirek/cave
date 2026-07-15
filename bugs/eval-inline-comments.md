---
name: eval-inline-comments
description: Accept documented inline comments on eval expectation lines.
severity: low
area: "@cavelang/eval"
source: "https://github.com/mirek/cave/pull/15"
files:
  - packages/eval/src/queries.ts
---

# Eval rejects its documented inline comments on expectations

## Problem

Documentation shows `none ; comment`, but the parser checks exact trimmed
equality with `none` and does not strip inline comments from expectation lines.

## Impact

Otherwise-valid fixtures are rejected before the agent runs.

## Direction

Apply the shared comment splitter to expectation lines before parsing.
