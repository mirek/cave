---
"@cavelang/cli": patch
---

Keep playground worker failure replies and fatal cleanup classification intact
when thrown values cannot be formatted. Preserve original WASM cleanup failures
and provide a printable diagnostic fallback.
