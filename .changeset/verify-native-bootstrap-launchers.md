---
"@cavelang/cli": patch
---

Exercise bootstrap with real local executable shims for pnpm, Corepack, and npm, checking version resolution, output, and installation status in paths containing spaces. Run these dependency-free checks in every CI runtime-matrix job before dependency installation, including native Windows .cmd shims.
