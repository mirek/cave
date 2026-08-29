# Monorepo — Tutorial I

The fixtures behind [Tutorial I in the root README](../../README.md#tutorial-i--a-monorepo-one-claim-at-a-time):
a small package graph that grows one idea per step. Run from this directory
with `cave` on the path (`pnpm install` at the repository root puts it there)
and no `repo.db` yet.

| Step | File | Adds |
|---|---|---|
| 2 | `packages.cave` | five `USES` edges — claims, `cave add`, `cave query` with `?variables` |
| 3–4 | — | inverse reads (`USED-BY`) and transitive hops (`USES+`) over the same rows |
| 5 | `details.cave` | `IS` types, `HAS` attributes, `#tags`, indented prefix shorthand |
| 6 | `files.cave` | a verb of your own (`IMPORTS REVERSE IMPORTED-BY`), `CONTAINS`, continuation lines |
| 7 | `deps.csv`, `deps.map.cave` | `cave connect`: deterministic structured ingestion, digests, `--prune` retraction |
| 8 | — | `@src:` sources, `@ N%` confidence, coexisting contradictions, retraction by appending `@ 0%` |
| 9 | `advisories.cave` | a rule (`premises => conclusion`), `cave derive`, `BECAUSE`/`VIA` lineage |
| 10 | `shapes.cave` | `EXPECTS` shapes and the `cave check` health report |
| 11 | `brief.md` | `cave report`: a cited markdown deliverable |
| 12 | — | `cave serve`, `cave mcp`, `cave ingest` |

Step 7 asks you to edit `deps.csv` (`billing,api-client` → `billing,ui`)
before the `--prune` run; restore the file afterwards (`git checkout
deps.csv`) if you want to replay the tutorial from the start.
