---
"@cavelang/automate": patch
"@cavelang/cli": patch
---

Report agent reply persistence errors as failed automation steps after rolling back the reply, allowing later steps to run while preserving no-replay semantics.
