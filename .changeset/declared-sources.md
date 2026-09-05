---
"@cavelang/cli": minor
---

Declared sources (spec §23.4): `source/<name> HAS path: …` claims persist a `cave connect` invocation in-band, with `map`, `key`, `format`, `delimiter`, `table`, `sql`, and `records` attributes mirroring the options; a `.cave` path needs no map and is a lifecycle unit. `cave connect` with no source runs every declared source (`--list`, `--name`, `--force`, `--prune`, `--dry-run`, `--watch`, `--query`), `cave query --sources` overlays them in a rolled-back transaction, and a CAVE text file used as `--db` follows its declared sources on every open, in every surface. Declared sources stamp `@src:<name>/<key>` and keep digests under `source/<name>/<key>`, so the §26.3 policy on the same entity applies to what they yield. `@cavelang/connect` exports `Declared`, `assemble`, `declaredNaming`, `adHocNaming`, and `Source.loadSync`; `@cavelang/store`'s `openAt` and `openText` take an `assemble` hook.
