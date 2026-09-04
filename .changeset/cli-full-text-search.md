---
"@cavelang/cli": minor
---

Add `cave search`, an FTS5 full-text search from the shell over the store's index (subject, verb, object, attribute name, value text, comment, and the raw line, so tags, contexts, and inverse spellings match too): one literal phrase by default, `--raw` for FTS5 MATCH syntax, `--limit` (default 100) with a trailing cap notice, and `--json` emitting a `cave.search/v1` object of `cave.claim/v1` records. `cave query` binding lines now end with the matched claim's comment (`?x = value  ; comment`) so the evidence written next to a claim reaches the reader. The `cave_search` MCP tool gains `limit` (default 100) and describes the indexed columns.
