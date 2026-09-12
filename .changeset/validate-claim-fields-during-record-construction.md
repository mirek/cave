---
"@cavelang/store": patch
---

Validate captured claim fields during structured-record construction using the
same checks as decoding. Reject missing raw text, non-boolean flags and malformed
terms, payloads or optional metadata before returning a record.
