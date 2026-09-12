---
"@cavelang/cli": minor
---

Validate rule, action, and automation preludes before trusting cached digests.
Invalid preludes now reject the declaration call without appending partial
rows or declarations, including retries against older cached failures.
Also return failure from cave derive for declaration errors in text and JSON.
