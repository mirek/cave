---
name: typecheck-build-semantics
description: Remove duplicate emitting builds or name them accurately.
status: open
priority: low
area: tooling
source: implementation-audit
---

# Clarify typecheck and build

## Problem

Both scripts run composite `tsc -b`, so `make check` emits and builds twice while `typecheck` implies a side-effect-free operation.

## Direction

Either define a true check-only path or collapse the duplicate target and document that validation builds artifacts.

## Done when

- Local and CI commands do no redundant compilation.
- Script names and documentation describe their side effects.
- Incremental and clean-build behavior is tested.
