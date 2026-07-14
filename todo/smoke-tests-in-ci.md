---
name: smoke-tests-in-ci
description: Exercise packed artifacts before merge and publish.
status: open
priority: high
area: ci
source: implementation-audit
---

# Run smoke tests in CI

## Problem

`scripts/smoke.sh` is the only check of pack-time exports and binary paths, but neither CI nor publish runs it.

## Direction

Pack and install the release artifacts in an isolated job before a change can merge or publish.

## Done when

- CI tests the exact package layout produced for npm.
- Publish depends on the same successful artifact checks.
- A tag cannot bypass required build and smoke validation.
