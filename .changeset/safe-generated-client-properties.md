---
"@cavelang/cli": patch
"@cavelang/shape": patch
---

Emit computed property names in generated readers so fields such as __proto__ remain own data properties instead of changing the result object's prototype.
