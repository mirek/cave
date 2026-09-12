---
"@cavelang/cli": patch
---

Reject nonstring CSV and TSV delimiters without coercion, including explicit null, instead of accepting values that cannot split fields correctly. Preserve default delimiters when omitted.
