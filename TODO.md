# CAVE — TODO

## Active backlog

- [Restore release coherence](todo/release-coherence.md) — Unblock version PR creation and return every published package, manifest, and tag to one release identity.
- [Scale sensitivity-scoped views](todo/sensitivity-scoped-view-performance.md) — Preserve fail-closed visibility without rebuilding the visible store for every read.
- [Harden external process execution](todo/external-process-boundary.md) — Centralize shell and agent execution with portable arguments, bounded output, and full process cleanup.
- [Define and test runtime/platform support](todo/runtime-platform-contract.md) — Align Node and OS compatibility promises with CI coverage and explicit job limits.
- [Validate packed type and API contracts](todo/packed-type-api-contracts.md) — Test tarball declarations, resolution metadata, and public API changes as an external consumer.
- [Exercise the production browser bundle](todo/browser-production-smoke.md) — Run critical website and playground flows through the built GitHub Pages asset graph.
- [Make grammar builds reproducible](todo/grammar-build-reproducibility.md) — Remove unverified network downloads from ordinary installs and verify generated grammar artifacts.
- [Automate dependency maintenance](todo/dependency-action-maintenance.md) — Add low-noise recurring npm and action updates plus production advisory checks.

New work belongs in a self-contained `todo/<name>.md` file linked here.
Deliberate non-features and their evidence-based reopening criteria live in
[PROJECT-BOUNDARIES.md](PROJECT-BOUNDARIES.md); completed roadmap history lives
in [RETIRED-ROADMAP.md](RETIRED-ROADMAP.md); suspected defects are tracked
separately in [BUGS.md](BUGS.md).
