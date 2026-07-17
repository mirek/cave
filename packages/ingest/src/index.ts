/**
 * `@cavelang/ingest` — LLM-driven knowledge ingestion.
 *
 * ```sh
 * cave ingest 'src/**' https://example.com/design-notes --db k.db \
 *   --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
 * ```
 *
 * Library API for SDK scripts:
 *
 * ```ts
 * import { run } from '@cavelang/ingest'
 * import { open } from '@cavelang/store'
 *
 * const store = open('k.db')
 * await run({
 *   db: 'k.db', store, patterns: ['docs/**'], mode: 'stdout', embed: true,
 *   agent: async prompt => callYourSdk(prompt),  // returns CAVE text
 *   // policy: 'lenient'                         // strict is the default
 * })
 * ```
 */

export * as Context from './context.ts'
export * as Files from './files.ts'
export * as Web from './web.ts'
export { buildPrompt, extractionRules, readInstructions } from './prompt.ts'
export type { Mode, PromptInput } from './prompt.ts'
export { caveTextOf, promptFor, run, runShellAgent, selectBatches, writeMcpConfig } from './run.ts'
export type {
  Agent, AgentContext, Batch, BatchReport, Options, Policy, Report, ShellAgentProcessOptions,
  SourceReport, SourceStatus
} from './run.ts'
export { runIngest } from './main.ts'
