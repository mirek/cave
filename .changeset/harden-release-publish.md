---
"@cavelang/core": patch
---

Harden the release publish script against partial publishes: the already-published guard now checks every public package (not a single sentinel), `pnpm -r publish` retries only publish what's missing, the `v<version>` tag is created on a later run if an earlier one published everything but died before tagging, and first-ever packages (which npm trusted publishing cannot cover until they exist on the registry) are called out up front.
