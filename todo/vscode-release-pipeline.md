---
name: vscode-release-pipeline
description: Package, version, and publish the VS Code extension.
status: open
priority: low
area: release
source: implementation-audit
---

# Add a VS Code release pipeline

## Problem

The extension bundles in tests but has no `vsce package` validation, release channel, or inclusion in lockstep version stamping.

## Direction

Define whether the extension is a released product; if so, package and version it from the same release source with marketplace credentials isolated.

## Done when

- A packed VSIX is validated in CI.
- Version and changelog policy are explicit.
- Publishing is repeatable, permission-scoped, and documented.
