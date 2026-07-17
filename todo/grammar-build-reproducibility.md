---
name: grammar-build-reproducibility
description: Make grammar generation verifiable and resilient to unavailable external downloads.
priority: medium
area: tooling
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Make grammar builds reproducible

## Problem

A clean install blocks on an external `tree-sitter-cli` binary download, and
the grammar toolchain includes a second external WASI SDK download. The fetched
artifacts do not have a repository-enforced content hash. Ordinary contributor
setup and CI are therefore coupled to external availability and cannot prove
that the downloaded tools are the intended bytes.

## Direction

Remove tool downloads from the ordinary install path where practical. Pin every
required external artifact by version and cryptographic digest, cache it in CI,
and provide a documented offline or pre-provisioned path. Treat generated
grammar output as a reproducible artifact: regenerate it in CI and fail on a
diff.

## Done when

- A normal install does not require an unverified binary download.
- Every fetched binary or SDK has a pinned source and checked digest.
- CI caching does not bypass digest verification.
- Grammar generation succeeds from documented pre-provisioned inputs without
  network access.
- CI regenerates committed grammar artifacts and fails when they differ.
- Failure messages identify the missing artifact and the supported recovery
  command.
