---
"@cavelang/cli": patch
---

`cave doctor` no longer certifies nightly or release-candidate Node builds (for example `26.0.0-nightly…` or `24.0.0-rc.1`) as supported: only stable releases on the 22.18+, 24, and 26 lines pass the runtime check.
