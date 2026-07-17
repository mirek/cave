---
name: runtime-platform-contract
description: Align advertised Node and operating-system support with an explicit CI test matrix.
priority: medium
area: runtime
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Define and test the runtime/platform contract

## Problem

Package manifests advertise Node `>=22.18`, but the main CI path exercises
only Node 22 on Ubuntu. This leaves the minimum supported Node release, newer
major releases, and platform-sensitive behavior unverified. CI jobs also lack
explicit timeouts, so a hung native build, download, or process test can consume
the full provider limit.

## Direction

Write down the supported Node and OS contract, then encode the smallest matrix
that proves it. At minimum, test the exact minimum Node version and the current
recommended release. Add Windows or macOS coverage wherever filesystem,
process, native-module, quoting, or packaging behavior differs.

Use explicit workflow timeouts and keep expensive coverage in focused jobs
rather than multiplying the complete suite unnecessarily.

## Done when

- The support policy names exact Node versions and supported operating systems.
- CI tests the minimum Node version rather than only its major line.
- CI tests the current recommended Node release.
- Platform-sensitive process, path, package, and native-module tests run on each
  supported OS.
- Every CI job has a deliberate timeout.
- Package `engines`, documentation, and CI agree on the contract.
