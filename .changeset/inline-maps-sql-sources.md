---
"@cavelang/cli": minor
---

Mapping templates can be written inline as a comma-separated list of claim lines (`--map '?name IS person, ?name WORKS-AT ?company'`, or `source/<name> HAS map:` with the same text), and `--sql` reshapes any tabular source — csv, tsv, json, jsonl — through a temporary in-memory SQLite table before the mapping sees the records (spec §23.1). `@cavelang/connect` exports `Template.isInline`, `Template.inlineDocument`, `Template.parseAny`, and `Source.queryRecords`; `@cavelang/parser` exports `Token.topLevel` and `Token.splitTopLevel`, which rules and actions now share.
