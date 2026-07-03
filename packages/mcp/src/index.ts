/**
 * `@cave/mcp` — the CAVE engine as an MCP server.
 *
 * ```jsonc
 * // client configuration
 * { "command": "cave", "args": ["mcp", "--db", "knowledge.db"] }
 * ```
 *
 * Tools: cave_add, cave_query, cave_search, cave_about, cave_neighbors,
 * cave_reconstruct, cave_export, cave_lint. Server instructions carry the
 * spec §22 compact card so connected models can write CAVE directly.
 */

export { createServer, serve, instructions, protocolVersion, serverInfo } from './server.ts'
export { runMcp } from './main.ts'
export { tools } from './tools.ts'
export type { Tool } from './tools.ts'
