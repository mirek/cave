---
name: browser-production-smoke
description: Exercise critical website and playground behavior through the actual production bundle.
priority: medium
area: website
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Exercise the production browser bundle

## Problem

The website builds and its adapter logic is tested under Node, but there is no
real-browser end-to-end check of the production asset graph. Browser-only
failures in workers, WASM loading, base paths, cross-origin isolation, dynamic
imports, or GitHub Pages routing can therefore pass unit tests and appear only
after deployment.

## Direction

Serve the production build under the same base-path assumptions as GitHub Pages
and run a small browser smoke suite. Exercise the highest-value user flow
through the actual bundled worker and WASM assets rather than mocked adapters.

Keep the suite narrow enough for reliable CI while making deployment-specific
failures observable before publish.

## Done when

- CI builds and serves the production website artifact.
- A real browser loads the site from the configured non-root base path.
- The playground executes a representative model end to end.
- The test verifies worker startup, WASM resolution, dynamic imports, and a
  visible result or diagnostic.
- Browser console errors, failed requests, and unhandled rejections fail the
  job.
- The deployment workflow depends on the production smoke result.
