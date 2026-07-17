# Project boundaries

CAVE does not intend to become a multi-tenant access-control framework,
organization/workspace/project hierarchy, app builder, analytics suite, hosted
service, distributed compute engine, model catalog, read-side audit logger, or
Kubernetes platform.

Staying small is part of the product. Every capability must remain runnable
offline, on one machine, over one SQLite file, with plain text as the escape
hatch. New core syntax requires semantic need; declarations stay in-band,
executable integrations stay out-of-band, storage stays append-oriented, and
the agent remains outside the language.

Claim-level selective erasure is also a permanent non-goal. CAVE cannot attest
to forgetting across SQLite remnants, exports, sync peers, backups, snapshots,
and storage hardware; claim history is permanent (spec §9.6). Data whose
retention policy requires selective deletion belongs outside a CAVE store.

## Resolved extension gates

Four exploratory proposals are deliberately outside the active roadmap. They
are not latent promises: the implemented alternatives keep the core language
bound, deterministic, and locally operable.

| Proposed extension | Project decision | Existing alternative |
|---|---|---|
| Variables in ordinary claims | Stored claims remain fully bound; `?x` is contextual syntax for CAVE-Q, rules, and connector templates. | Query and rule binding already provide scoped variables without ambiguous stored rows. |
| Reified `[S V O]` terms | Claims do not become recursively nestable values or acquire structural equality. | Qualifier/support edges, row IDs, claim keys, provenance, and scenario artifacts address the relevant relationship or record explicitly. |
| Temporal `(t -> expr)` functions | CAVE data contains observations, ranges, and linear trajectories, not executable formulas. | Tile scalar ranges, use layer-2 trajectories, or evaluate a bounded external model and record its inputs and result. |
| Socket, webhook, or push listeners | `cave connect` owns deterministic passes, file watch, and query-time overlays; network listeners remain external adapters. | A transport-specific bridge authenticates, retries, deduplicates, and writes a file or invokes a bounded connect pass. |

A future proposal may revisit one boundary only with a concrete workflow that
cannot be expressed cleanly by the listed alternative. It must specify the
missing identity, scope, determinism, security, lifecycle, and compatibility
semantics and arrive as a new design proposal—not as presumed backlog debt.
