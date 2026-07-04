#!/usr/bin/env node
/**
 * Standalone `cave mcp` entry — lets other packages (and MCP client
 * configurations) point at the server without going through `@cavelang/cli`.
 */

import { runMcp } from './main.ts'

process.exitCode = await runMcp(process.argv.slice(2))
