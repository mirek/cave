---
"@cavelang/shape": patch
"@cavelang/cli": patch
---

Anchor generated-client test fixtures to the test module rather than the process working directory, preserving workspace import resolution when running the shape suite from either the repository root or package directory.
