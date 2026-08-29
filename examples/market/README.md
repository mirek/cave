# Market watchlist — Tutorial II

The fixtures behind [Tutorial II in the root README](../../README.md#tutorial-ii--a-market-watchlist):
fictional companies, the themes that move them, news read by an LLM, rules
that turn theme exposure into per-company pressure, governed decisions, and
an automation that reacts. Run from this directory with `cave` on the path
and no `market.db` yet.

| Step | File | Adds |
|---|---|---|
| 13 | `ontology.cave` | `DRIVES` (weight as confidence, `#sign:±1`), `SUPPLIES`, `SUPPLIES+` contagion |
| 14 | `news/*.md`, `instructions.md` | `cave ingest --stdout --agent 'claude -p'`: LLM extraction with `@src:file#Lx-Ly` spans and per-file digests |
| 14 | `news.cave` | what one real run recorded for the first two articles — `cave add` it instead of running an agent |
| 15 | `rules.cave` | four sign rules deriving `PRESSURES #direction:…`, noisy-AND confidence, lineage |
| 16 | — | valid time: a `300B -> 450B USD/yr @2025..2026` trajectory read with `--at` |
| 17 | `actions.cave` | `cave act`: parameterized, precondition-checked writes |
| 18 | `automations.cave`, `news-2026-08-20.cave` | `cave automate --once`: armed on declaration, fires on the third article, runs the action |
| 19 | `brief.md` | `cave report --at 2026-08`: the cited morning brief |

The two `news*.cave` files are the checked-in output of the ingest runs shown
in the README (Claude Code, 2026-08-29); an agent of your own will phrase the
comments and confidences differently, which is the point of
[`cave eval`](../eval).

The companies, themes, and articles are invented for the tutorial. Nothing
here is investment advice.
