---
name: publish-workflow-guards
description: Validate release branch, version, runtime, cache, and retries.
status: open
priority: high
area: release
source: implementation-audit
---

# Harden publish guards

## Problem

The publish script now checks every public package, safely resumes partial
publishes, and can create a missing tag after an interrupted post-publish step.
Remaining gaps are branch/tag reachability validation, authoritative committed
versions, CI/publish runtime alignment, and external toolchain caching.

## Direction

Make the committed version authoritative, validate reachability and tag equality, align runtimes, cache external toolchains, and publish idempotently.

## Done when

- Invalid tags fail before building or authenticating to npm.
- CI and publish exercise the same supported runtime matrix.
- Interrupted releases can be resumed safely.
