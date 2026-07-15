/**
 * `@cavelang/eval` — golden-fixture extraction and query evals
 * and reconstruction policy evaluation.
 *
 * ```sh
 * cave eval suite/ --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
 * ```
 *
 * Library API for SDK scripts (agents and judges may be functions):
 *
 * ```ts
 * import { run } from '@cavelang/eval'
 *
 * const report = await run({
 *   suites: ['suite/'], mode: 'stdout', runs: 3,
 *   agent: async prompt => callYourSdk(prompt)   // returns CAVE text
 * })
 * ```
 */

export * as Suite from './suite.ts'
export * as Score from './score.ts'
export * as Queries from './queries.ts'
export * as Loop from './loop.ts'
export { judgePrompt, parsePairs } from './judge.ts'
export { fixtureCount, run } from './run.ts'
export type { Agent, CaseReport, Judge, Mean, Options, Report, RunReport } from './run.ts'
export { meetsMin, render, runEval } from './main.ts'
