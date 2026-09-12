---
"@cavelang/cli": patch
---

Preserve evaluation failures when removal of the owned temporary root also fails. Retain both diagnostics and error identities while respecting the captured keep policy, with cancellation and fixture-read regressions.
