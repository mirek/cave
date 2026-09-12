---
"@cavelang/query": patch
"@cavelang/cli": patch
---

Capture query match fields before evidence projection so repeated getters or caller mutation cannot replace bindings, interpolation metadata or evidence rows during structured-record construction.
