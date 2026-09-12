---
"@cavelang/core": patch
---

Capture source-span endpoints once before validation and formatting. Changing getters can no longer substitute invalid or different provenance anchors, and rejection diagnostics retain the values that failed validation.
