/**
 * LLM-driven policy — adapter sketch (spec §18).
 *
 * The deterministic heuristic in `reconstruct.ts` is a stand-in for a
 * policy where an LLM makes the select/score/stop decisions. The loop
 * stays the same; only the policy changes. Because LLM calls are
 * asynchronous, the adapter runs the loop with an async policy of the
 * same shape.
 *
 * Sketch (intentionally not implemented — the agent layer is outside the
 * language spec, and this package stays dependency-free):
 *
 * ```ts
 * export type Complete = (prompt: string) => Promise<string>
 *
 * export const llmPolicy = (complete: Complete): AsyncPolicy => ({
 *   async select(state) {
 *     // Render the frontier and the claims collected so far as canonical
 *     // CAVE text (emitClaim from @cave/canonical) — compact, line
 *     // oriented, and exactly the notation the model was told about in
 *     // its system prompt.
 *     const prompt = [
 *       'You are reconstructing memory over a CAVE claim graph.',
 *       'Collected so far:', ...state.collected.map(emitClaim),
 *       'Frontier cues:', ...state.frontier.map(cue => `${cue.entity} @ ${cue.score}`),
 *       'Reply with the single cue to expand next, or STOP.'
 *     ].join('\n')
 *     const answer = (await complete(prompt)).trim()
 *     return answer === 'STOP' ?
 *       undefined :
 *       state.frontier.find(cue => cue.entity === answer)
 *   },
 *   async score(edge, from) {
 *     // Cheap local heuristic stays fine here — models are better spent
 *     // on select/stop than on per-edge arithmetic. Alternatively ask the
 *     // model to rate relevance of `edge.rel ?? edge.verb` to the query.
 *     return from.score * edge.conf * 0.8
 *   },
 *   async done(state) {
 *     if (state.steps >= 32) return true
 *     const prompt = [
 *       'Given the collected claims below, is the original query answered?',
 *       ...state.collected.map(emitClaim),
 *       'Reply YES or NO.'
 *     ].join('\n')
 *     return (await complete(prompt)).trim() === 'YES'
 *   }
 * })
 * ```
 */

import type { Claim } from '@cave/core'
import type { Edge } from './store.ts'
import type { Cue, State } from './reconstruct.ts'

/** Async twin of `Policy` for LLM-backed implementations. */
export type AsyncPolicy = {
  select(state: State): Promise<undefined | Cue>
  score(edge: Edge, from: Cue): Promise<number>
  done(state: State): Promise<boolean>
}

/** Minimal completion function an adapter needs. */
export type Complete = (prompt: string) => Promise<string>

/** Claims rendered for a prompt — kept as a type hook for adapters. */
export type PromptContext = {
  readonly collected: readonly Claim.t[]
  readonly frontier: readonly Cue[]
}
