---
"@cavelang/cli": patch
---

Prevent connector pruning from retracting prior data when failed records cannot be identified. Roll back an entire declared-source replacement if any record fails, preserving the last good data and enabling a complete retry. Document these failure and recovery contracts in the connector reference, specification, architecture, and book.
