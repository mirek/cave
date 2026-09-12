---
"@cavelang/cli": patch
---

Read MCP source and hook options once per tool call. Changing getters no longer
select a different provenance stamp within one call; configuration stays lazy
and refreshes on subsequent calls, including recovery after lookup failures.
