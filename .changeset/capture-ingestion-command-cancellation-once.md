---
"@cavelang/cli": patch
---

Capture the ingestion command's cancellation signal once and retain it through source selection, execution and final checks. Prevent changing context getters from substituting another signal or hiding cancellation of the original signal.
