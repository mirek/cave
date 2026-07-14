---
name: package-license-files
description: Include complete license attribution in every package.
status: open
priority: medium
area: packaging
source: implementation-audit
---

# Ship license files

## Problem

Most package manifests list `License.md`, but local packaging does not copy it, and the license links an `Authors.md` file that packages omit.

## Direction

Make package contents independent of the release entrypoint and include every referenced attribution file.

## Done when

- `pnpm pack` and CI publishing produce identical license contents.
- Every public package includes complete license and author information.
- Smoke tests inspect tarball contents.
