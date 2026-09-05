---
"@cavelang/cli": patch
---

Declared sources (spec §23.4): declarations are re-read after every followed source and a re-declared source runs again, so a `.cave` source that supersedes a path or mapping wins in passes, assembly, overlays, and dry runs alike; source names are one path segment, so they cannot collide with record keys; and a text store's `--sources` overlay recognizes record-only sources as already followed.
