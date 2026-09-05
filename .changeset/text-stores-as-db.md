---
"@cavelang/store": minor
---

`--db` names a store by content, not extension (spec §13.7): a CAVE text file replays into an in-memory store for every command that only reads (`query`, `search`, `resolve`, `check`, `export`, `report`, `generate`, `serve`, `mcp --read-only`, dry-run and `--list` modes), with `cave import` semantics. Commands that append refuse a text file and point at `cave import`; a read against a missing path is now an error instead of a silently created empty database, reads open SQLite read-only and never migrate an older store (they name the writing command that does), and dry runs open without migration. `@cavelang/store` exports `openAt`, `openText`, `kindOf`, `isStoreFile`, `LocateError`, an `access` open option (`read-only | no-migrate | migrate`), and `Schema.check`/`Schema.versionOf`; `@cavelang/sync` re-exports the shared `isStoreFile`.
