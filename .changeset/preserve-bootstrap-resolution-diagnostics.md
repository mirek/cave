---
"@cavelang/cli": patch
---

Preserve the final package-manager version probe's stderr, exit or signal detail, and process-start cause when bootstrap cannot resolve the declared pnpm version. Continue stopping before dependency installation on failure or a mismatched version.
