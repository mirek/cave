---
name: mcp-protocol-compliance
description: Negotiate MCP and JSON-RPC correctly.
status: open
priority: medium
area: mcp
source: implementation-audit
---

# MCP protocol compliance

## Problem

The server echoes any requested protocol version and silently drops JSON-RPC batch arrays, creating behavior that is neither negotiated nor validly rejected.

## Direction

Use the official MCP SDK where practical, or maintain an explicit conformance layer for supported protocol versions, batches, notifications, and errors.

## Done when

- Unsupported protocol versions fail with a valid response.
- Batch and malformed input behavior follows JSON-RPC.
- Conformance fixtures cover initialization and every transport mode.
