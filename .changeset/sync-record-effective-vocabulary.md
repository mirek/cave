---
"@cavelang/cli": patch
"@cavelang/sync": patch
---

Use the effective verb registry when declaring sync merge events so conditional
vocabulary claims cannot suppress the required top-level declaration.
Clarify that sync skips matching identities and rejects identities reused with
different content.
