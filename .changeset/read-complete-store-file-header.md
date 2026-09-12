---
"@cavelang/store": patch
"@cavelang/cli": patch
---

Accumulate short file reads when detecting SQLite headers so valid databases are not misclassified as text; stop at EOF and retain descriptor cleanup.
