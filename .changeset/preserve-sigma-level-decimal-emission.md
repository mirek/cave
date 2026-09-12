---
"@cavelang/canonical": patch
"@cavelang/store": patch
---

Emit sigma levels as lossless plain decimals so tiny and large positive finite overrides survive canonical export and strict reimport. Reject invalid structured sigma levels during emission.
