/**
 * The reconstruction loop (spec §18, §11.3) — Ji et al.'s Algorithm 1
 * (*Memory is Reconstructed, Not Retrieved*, 2026) as a functional loop
 * over the CAVE graph:
 *
 * - **Cues** are entities used as query anchors;
 * - **route**: expanding a cue collects its claims (content) and pushes
 *   scored neighbors — forward edges, named inverse edges, and topic
 *   containment in both directions (ϕτ→e and ϕv→(c,g)) — onto the
 *   frontier;
 * - **select / stop** are policy decisions, injected — the loop itself is
 *   deliberately outside the language (spec §18).
 *
 * The loop comes in two shapes sharing one step core: `reconstruct` for
 * synchronous policies (the deterministic heuristic), `reconstructAsync`
 * for policies that await a model between steps (`llmPolicy`).
 */

import { Claim, Key } from '@cavelang/core'
import type { CaveStore, Edge } from './store.ts'

/** A scored frontier entry. */
export type Cue = {
  readonly entity: string
  readonly score: number
  readonly depth: number
}

export type State = {
  readonly frontier: readonly Cue[]
  readonly visited: ReadonlySet<string>
  readonly collected: readonly Claim.t[]
  readonly steps: number
}

/** Injectable policy: select the next cue, score neighbors, decide to stop. */
export type Policy = {
  /** Next cue to expand, `undefined` to stop. Must pick from `state.frontier`. */
  select(state: State): undefined | Cue
  /** Frontier score of a neighbor reached via `edge` from `from`. */
  score(edge: Edge, from: Cue): number
  /** Stop condition, checked before every step. */
  done(state: State): boolean
}

/** Async twin of `Policy` for LLM-backed implementations (`llmPolicy`). */
export type AsyncPolicy = {
  select(state: State): Promise<undefined | Cue>
  score(edge: Edge, from: Cue): Promise<number>
  done(state: State): Promise<boolean>
}

export type Step = {
  readonly step: number
  readonly cue: Cue
  readonly edges: readonly Edge[]
  readonly collected: number
}

export type Reconstruction = {
  /** Deduplicated claims, in discovery order. */
  readonly claims: readonly Claim.t[]
  readonly trace: readonly Step[]
  readonly state: State
}

/** Mutable loop accumulators, shared by the sync and async twins. */
type Loop = {
  state: State
  readonly seen: Set<string>
  readonly claims: Claim.t[]
  readonly trace: Step[]
}

const loopOf = (seeds: readonly string[]): Loop => ({
  state: {
    frontier: seeds.map(entity => ({ entity, score: 1, depth: 0 })),
    visited: new Set(),
    collected: [],
    steps: 0
  },
  seen: new Set(),
  claims: [],
  trace: []
})

/** Relational edges of a cue, both directions (spec §11.3 routing). */
const edgesOf = (store: CaveStore, cue: Cue): Edge[] =>
  [...store.forward(cue.entity), ...store.reverse(cue.entity)]

/**
 * Applies one expansion: mark the cue visited, collect its claims, offer
 * scored neighbors, merge them into the frontier. `scores[i]` belongs to
 * `edges[i]` — computed by the caller, which is what lets the sync and
 * async loops share this core.
 */
const applyStep = (
  store: CaveStore,
  loop: Loop,
  cue: Cue,
  edges: readonly Edge[],
  scores: readonly number[]
): void => {
  const visited = new Set(loop.state.visited)
  visited.add(cue.entity)
  let collected = 0
  for (const claim of store.claimsAbout(cue.entity)) {
    const key = Key.of(claim)
    if (!loop.seen.has(key)) {
      loop.seen.add(key)
      loop.claims.push(claim)
      collected += 1
    }
  }
  const neighbors = new Map<string, Cue>()
  edges.forEach((edge, index) => {
    if (visited.has(edge.to)) {
      return
    }
    const score = scores[index]!
    const existing = neighbors.get(edge.to)
    if (existing === undefined || existing.score < score) {
      neighbors.set(edge.to, { entity: edge.to, score, depth: cue.depth + 1 })
    }
  })
  // Merge offers into the frontier keeping the maximum score per entity:
  // a weaker path discovered later must never downgrade a pending cue,
  // or adding knowledge could remove reachable claims.
  const merged: Cue[] = []
  for (const entry of loop.state.frontier) {
    if (entry.entity === cue.entity) {
      continue
    }
    const offered = neighbors.get(entry.entity)
    if (offered !== undefined) {
      merged.push(offered.score > entry.score ? offered : entry)
      neighbors.delete(entry.entity)
    } else {
      merged.push(entry)
    }
  }
  merged.push(...neighbors.values())
  loop.state = {
    frontier: merged,
    visited,
    collected: loop.claims,
    steps: loop.state.steps + 1
  }
  loop.trace.push({ step: loop.state.steps, cue, edges, collected })
}

const reconstructionOf = (loop: Loop): Reconstruction =>
  ({ claims: loop.claims, trace: loop.trace, state: loop.state })

/**
 * Runs the loop from seed entities until the policy stops or the frontier
 * empties. Pure given its inputs — same store + policy + seeds, same
 * reconstruction.
 */
export const reconstruct = (store: CaveStore, policy: Policy, seeds: readonly string[]): Reconstruction => {
  const loop = loopOf(seeds)
  while (!policy.done(loop.state)) {
    const cue = policy.select(loop.state)
    if (cue === undefined) {
      break
    }
    const edges = edgesOf(store, cue)
    applyStep(store, loop, cue, edges, edges.map(edge => policy.score(edge, cue)))
  }
  return reconstructionOf(loop)
}

/**
 * The async twin of `reconstruct`, for policies that await a model between
 * steps (spec §18): same algorithm, same trace, decisions awaited.
 */
export const reconstructAsync = async (
  store: CaveStore,
  policy: AsyncPolicy,
  seeds: readonly string[]
): Promise<Reconstruction> => {
  const loop = loopOf(seeds)
  while (!(await policy.done(loop.state))) {
    const cue = await policy.select(loop.state)
    if (cue === undefined) {
      break
    }
    const edges = edgesOf(store, cue)
    const scores: number[] = []
    for (const edge of edges) {
      scores.push(await policy.score(edge, cue))
    }
    applyStep(store, loop, cue, edges, scores)
  }
  return reconstructionOf(loop)
}

export type HeuristicOptions = {
  /** Per-hop score decay (default 0.8). */
  readonly decay?: number
  /** Hard step budget (default 16). */
  readonly maxSteps?: number
  /** Cues scoring below this are never selected (default 0.05). */
  readonly minScore?: number
  /** Stop once this many claims are collected (default ∞). */
  readonly maxClaims?: number
}

/**
 * Deterministic heuristic policy for dependency-free testing (spec §18):
 * greedy best-first by score (FIFO tiebreak), score = parent score ×
 * edge confidence × decay, hard budgets for steps and claims. Also the
 * eval baseline the LLM policy is measured against (spec §18).
 */
export const heuristicPolicy = (options: HeuristicOptions = {}): Policy => {
  const decay = options.decay ?? 0.8
  const maxSteps = options.maxSteps ?? 16
  const minScore = options.minScore ?? 0.05
  const maxClaims = options.maxClaims ?? Number.POSITIVE_INFINITY
  return {
    select(state) {
      let best: undefined | Cue
      for (const cue of state.frontier) {
        if (cue.score < minScore) {
          continue
        }
        if (best === undefined || cue.score > best.score) {
          best = cue
        }
      }
      return best
    },
    score(edge, from) {
      return from.score * edge.conf * decay
    },
    done(state) {
      return state.steps >= maxSteps || state.collected.length >= maxClaims
    }
  }
}
