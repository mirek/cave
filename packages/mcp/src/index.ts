/**
 * `@cavelang/mcp` — the CAVE engine as an MCP server.
 *
 * ```jsonc
 * // client configuration
 * { "command": "cave", "args": ["mcp", "--db", "knowledge.db"] }
 * ```
 *
 * Tools: cave_add, cave_query, cave_search, cave_about, cave_neighbors,
 * cave_reconstruct, cave_export, cave_lint — plus one generated
 * `act_<name>` tool per action declared in the store (spec §25.5), the
 * governed write vocabulary. Server instructions carry the spec §22
 * compact card so connected models can write CAVE directly.
 * `--read-only` / `--tools <list>` narrow the served surface — the
 * minimum viable agent permission boundary.
 */

export { agentSource, createServer, serve, instructions, instructionsFor, protocolVersion, serverInfo, specCard } from './server.ts'
export type { ServerOptions } from './server.ts'
export { runMcp } from './main.ts'
export { actionTools, actToolName, actToolPrefix, scopedActionTools, scopedTools, tools } from './tools.ts'
export type { Scope, Tool, ToolContext } from './tools.ts'
