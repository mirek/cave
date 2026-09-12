---
"@cavelang/cli": patch
---

Select rule declarations and check digest-prefix ambiguity inside the retraction
transaction, preventing concurrent declarations from escaping retraction or
causing an ambiguous prefix to retract a rule.
