---
name: doctor-node-range
description: Make cave doctor validate the same bounded Node release lines declared by package engines and CI.
priority: high
area: cli/runtime
source: Codex exploratory use
audited-commit: 21a9f5b25d660eed886ce288ab8cbb6fbd4ee16c
audited-at: 2026-07-18
---

# Align `cave doctor` with the supported Node range

## Problem

The package contract supports Node `^22.18.0 || ^24.0.0`, and pnpm correctly
warns on Node 26.4.0. On that same runtime, `cave doctor --json` reports
`runtime.node` as a passing check, says Node 26.4.0 satisfies `>=22.18.0`, sets
the overall report to `ok: true`, and exits successfully.

The diagnostic implements only a minimum-version comparison, so every future
major is presented as supported even though package metadata, documentation,
and CI deliberately restrict support to the Node 22 and 24 release lines. This
turns the command intended to explain environment problems into contradictory
evidence.

## Direction

Validate the complete supported range rather than a standalone lower bound.
Keep the runtime policy in one reusable source, or add a projection test that
prevents the doctor, package manifests, documentation, and CI matrix from
drifting again. Remediation should name both supported release lines and the
exact minimum.

## Done when

- `cave doctor` passes Node 22 from 22.18.0 onward and supported Node 24
  releases.
- It fails versions below 22.18.0, Node 23, Node 25, Node 26, and later
  unadopted majors.
- Human and JSON output use the same status, support wording, and remediation.
- Tests exercise boundary versions without depending on the Node version that
  happens to run the test process.
- Package `engines`, root and CLI documentation, CI, and doctor share or verify
  one support policy.
