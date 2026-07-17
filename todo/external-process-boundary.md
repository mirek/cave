---
name: external-process-boundary
description: Make shell and agent execution portable, bounded, and safe across supported platforms.
priority: high
area: runtime
source: Codex repository audit
audited-commit: a4b41b97af33e36f4d38426575102d9eb57f860f
audited-at: 2026-07-17
---

# Harden external process execution

## Problem

External-command paths construct POSIX single-quoted command strings and execute
them with `shell: true`. That quoting model is not portable to Windows shells
and expands the injection surface. Timeout handling can terminate the immediate
child while leaving descendants alive, and output collection is not
consistently bounded.

These risks affect integrations that invoke local shells or agent CLIs and can
turn malformed input, verbose children, or hung process trees into correctness
or resource-exhaustion failures.

## Direction

Create one process-execution abstraction shared by every external-command
integration. Prefer executable-plus-argument arrays with `shell: false`.
Where shell syntax is an intentional feature, select and document a platform
specific shell and escaping contract.

The abstraction should enforce bounded stdout/stderr, deterministic timeout and
abort behavior, process-tree cleanup, normalized exit information, and
redaction-safe diagnostics.

## Done when

- Ordinary command execution passes arguments without shell interpolation.
- Intentional shell execution has explicit platform support and tested escaping.
- Timeout and cancellation terminate descendant processes on every supported OS.
- stdout and stderr limits are configurable and fail with a typed diagnostic.
- Tests cover spaces, quotes, metacharacters, Unicode, non-zero exits, large
  output, cancellation, timeout, and child-process spawning.
- All existing external-command integrations use the shared abstraction.
