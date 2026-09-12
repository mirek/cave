---
"@cavelang/cli": patch
---

Check the manifest's supported Node ranges before bootstrap probes or invokes package managers. Unsupported runtimes now receive an actionable diagnostic pointing to .nvmrc before dependency installation begins.
