/**
 * `@cave/loop` — cave-loop, the active-reconstruction agent layer over the
 * CAVE graph (spec §18, non-normative).
 *
 * The agent layer is deliberately outside the language specification:
 * reconstruction is a *policy* over the graph. This package provides the
 * injectable `CaveStore` and `Policy` interfaces, an in-memory store with
 * inverse-aware reverse traversal, a deterministic heuristic policy, an
 * LLM-adapter sketch and a runnable multi-hop recovery demo.
 */

export * as Demo from './demo.ts'
export type { CaveStore, Edge } from './store.ts'
export { memoryStore, memoryStoreOfText } from './store.ts'
export { heuristicPolicy, reconstruct } from './reconstruct.ts'
export type { Cue, HeuristicOptions, Policy, Reconstruction, State, Step } from './reconstruct.ts'
export type { AsyncPolicy, Complete, PromptContext } from './llm.ts'
