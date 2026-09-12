---
"@cavelang/core": minor
"@cavelang/canonical": patch
---

Add Confidence.formatExact for lossless decimal percentage interchange and use it
in canonical claim emission. Parse percentages without a second rounding step,
preserving computed and tiny confidence through export, import, and text sync.
Keep Confidence.format as the existing rounded presentation formatter.
