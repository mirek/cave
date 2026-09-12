---
"@cavelang/cli": patch
---

Read each referenced connector record field once per record and reuse its value for repeated template slots and keyed bookkeeping. This keeps claims and digest identity consistent when programmatic records use changing getters.
