---
"@cavelang/cli": patch
---

Document asynchronous reconstruction's live-read contract and verify peer updates
between awaited expansions. Clarify that deterministic reconstruction requires a
stable store view; the loop itself does not open a transaction across awaits.
