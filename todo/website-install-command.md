---
name: website-install-command
description: Show a valid published-package installation path.
status: completed
priority: medium
area: website
source: architecture-review
---

# Fix the website install command

## Problem

The site presents `pnpm add @cavelang/cli`, which is ambiguous for a command-line application and may install locally without making `cave` readily invocable.

## Direction

Document a tested execution or global-install path and state supported Node and package-manager prerequisites.

## Done when

- A new user can copy the command and run `cave --version` successfully.
- npm, pnpm, or `pnpm dlx` guidance reflects the supported installation model.
- The website command is covered by package smoke validation.

## Outcome

The landing page now offers the directly runnable
`pnpm dlx @cavelang/cli version` command, which both fetches the published CLI
and proves the executable can start without implying a global installation.
