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

The publish workflow accepts broad version tags, force-stamps manifests, does not prove the commit is on `main`, differs from CI's Node runtime, depends on an uncached SDK download, and cannot cleanly resume a partial publish.

## Direction

Make the committed version authoritative, validate reachability and tag equality, align runtimes, cache external toolchains, and publish idempotently.

## Done when

- Invalid tags fail before building or authenticating to npm.
- CI and publish exercise the same supported runtime matrix.
- Interrupted releases can be resumed safely.
