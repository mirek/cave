---
"@cavelang/cli": patch
"@cavelang/shape": patch
---

Omit redundant confidence and negation columns from shape fact projections after SQL has filtered them, and remove duplicate index checks. Preserve historical latest-row selection and complete shape declarations while reducing repeated gate evaluation work.
