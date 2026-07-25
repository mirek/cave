---
name: cave
description: Use CAVE (Compressed Atomic Verb Expressions) as durable, local, append-only agent memory through its cave_* MCP tools or CLI. Use when recording project knowledge, decisions, constraints, evidence, provenance, or confidence; recalling stored facts; querying relationships; reconstructing multi-hop context; revising or retracting beliefs; or deciding how to model information in CAVE.
---

# Use CAVE

Treat CAVE as durable shared memory, not as scratch space. Recall relevant knowledge before reasoning, and record only information worth preserving across sessions.

## Start

1. Check for connected `cave_*` tools.
2. Call `cave_help` with `topic: overview` when available. It is the version-matched authority for the installed server.
3. If no CAVE server is connected, tell the user to install and register it:

```sh
pnpm i -g @cavelang/cli
copilot mcp add cave -- cave mcp --db "$HOME/cave.db"
```

Do not invent a connection or write to a different database.

## Recall

Choose the narrowest tool that fits:

- Use `cave_about` for everything currently known about one named entity.
- Use `cave_query` for a known relationship or value shape.
- Use `cave_search` when the stored entity or wording is unknown.
- Use `cave_neighbors` to walk named graph edges.
- Use `cave_reconstruct` to gather bounded multi-hop context before broader reasoning.
- Use `cave_export` only when portable canonical text is needed.

Use `aliases: true` only when equivalent names should match. Use `resolve: true` only when the user needs the policy-selected winner rather than every source.

## Record

Write one atomic fact per line. Prefer stable entity names, explicit relations, provenance, and honest confidence:

```cave
auth/middleware USES jwt @ 90%
checkout/errors CAUSE retry-storm @production @ 70% #topic:reliability
deploy/2026-07-25 YIELDS api/v2 @src:release-notes
```

Use `cave_lint` before `cave_add` for unfamiliar syntax or multi-line batches. The server adds agent provenance when a claim has no `@src:` context; preserve a more specific source when known.

Do not record guesses as facts. Qualify uncertainty, name the source, or ask the user when the distinction matters.

## Revise

Never edit history in place. Update confidence by appending the same claim identity and same `@src:`. Retract by appending it at `@ 0%` with an explanation. Allow conflicting sources to coexist.

Prefer a generated `act_<name>` tool over `cave_add` when a declared governed action fits. Run `cave_derive` when changed premises should materialize stored-rule conclusions.

## Protect data

CAVE history is permanent by design. Retraction, current-only views, resolution, and sensitivity filters do not guarantee deletion from SQLite remnants, exports, peers, or backups. Never store secrets or data requiring selective erasure.

Read [references/usage.md](references/usage.md) when exact syntax, query examples, or the current tool decision table is needed and `cave_help` is unavailable.
