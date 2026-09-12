---
"@cavelang/scenario": minor
---

Validate supplied scenario selections as strings naming variables bound by their CAVE-Q patterns before reading the store. Optional inputs with no rows now reject misspelled selections as invalid definitions instead of silently omitting the input. Subject, verb, object and attribute value variables remain selectable, and Boolean existence inputs may still omit select.
