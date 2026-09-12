---
"@cavelang/canonical": patch
"@cavelang/store": patch
---

Reject structured claim bodies that open comments or leave literal delimiters unmatched, preserving intended comments and quoted content. Report unrepresentable authored claims as canonicalization diagnostics before storage.
