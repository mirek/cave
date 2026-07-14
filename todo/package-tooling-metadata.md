---
name: package-tooling-metadata
description: Complete manifests and make tooling predictable.
status: open
priority: low
area: tooling
source: implementation-audit
---

# Polish package metadata and tooling

## Problem

Published manifests omit discoverability/support metadata, bootstrap can ignore the package-manager pin, clean misses extension output, and release actions use broad major tags.

## Direction

Standardize package metadata, honor the pinned toolchain, clean all generated output, and pin privileged actions to reviewed revisions.

## Done when

- Public manifests include consistent keywords, homepage, and issue links.
- Bootstrap installs the declared pnpm version on supported Node versions.
- Clean and workflow-security checks cover every workspace.
