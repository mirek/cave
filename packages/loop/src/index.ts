/**
 * `@cavelang/loop` — cave-loop, the active-reconstruction agent layer over the
 * CAVE graph (spec §18, non-normative).
 *
 * The agent layer is deliberately outside the language specification:
 * reconstruction is a *policy* over the graph. This package provides the
 * injectable `CaveStore` and `Policy` interfaces, an in-memory store and a
 * SQLite adapter, a deterministic heuristic policy (the eval baseline), the
 * LLM-driven policy over any shell-agent command template (spec §18)
 * and a runnable multi-hop recovery demo.
 */

export * as Demo from './demo.ts'
export type { CaveStore, Edge } from './store.ts'
export { memoryStore, memoryStoreOfText } from './store.ts'
export { sqliteStore } from './sqlite.ts'
export { heuristicPolicy, reconstruct, reconstructAsync } from './reconstruct.ts'
export type { AsyncPolicy, Cue, HeuristicOptions, Policy, Reconstruction, State, Step } from './reconstruct.ts'
export { llmPolicy, parseSelection, selectPrompt, shellComplete, stopToken } from './llm.ts'
export type { Complete, LlmOptions, ShellCompleteOptions } from './llm.ts'
