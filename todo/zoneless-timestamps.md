---
name: zoneless-timestamps
description: Make zoneless timestamp handling consistent.
status: open
priority: medium
area: temporal
source: implementation-audit
---

# Zoneless timestamps

## Problem

Bare `T` timestamps fall through to local-time parsing while bare dates are interpreted as UTC, so results depend on the machine timezone.

## Direction

Either reject timestamps without an offset or specify UTC consistently in core and query parsing.

## Done when

- `--as-of`, `WHERE tx`, and `--at` share one parser.
- Behavior is documented with explicit examples.
- Tests run under multiple process timezones.
