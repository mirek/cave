---
name: packed-type-api-contracts
description: Validate declarations, module resolution, and public API changes from packed artifacts.
priority: medium
area: packaging
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Validate packed type and API contracts

## Problem

The packed-artifact smoke checks do not compile a separate TypeScript consumer
against the produced tarballs and do not detect unintended public API changes.
A repository build can therefore pass while published `exports`, declaration
paths, module-resolution metadata, or inferred public types are unusable to a
consumer.

## Direction

Install packed tarballs into clean fixture projects and compile representative
imports under the module-resolution modes the project claims to support. Add a
checked API surface or equivalent declaration-diff gate for packages with
public TypeScript APIs.

Tests should consume only packed artifacts, never workspace source aliases.

## Done when

- A clean external TypeScript fixture installs the tarballs and type-checks
  representative root and subpath imports.
- Fixtures cover every documented module-resolution and module-format contract.
- Runtime smoke tests execute the same packed imports that compile.
- An intentional reviewable artifact records public API changes.
- CI fails on missing declarations, broken `exports`, accidental `any`,
  incompatible type changes, or workspace-only resolution.
