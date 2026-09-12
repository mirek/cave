---
"@cavelang/cli": patch
---

Preserve evaluation fixture exceptions when scratch-store close also fails, and retain the diagnostic chain through root removal. Share the private cleanup policy with the root scope and verify preflight failure ordering before agent calls.
