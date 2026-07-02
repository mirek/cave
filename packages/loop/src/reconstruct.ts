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
 */

import { Claim, Key } from '@cave/core'
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

/**
 * Runs the loop from seed entities until the policy stops or the frontier
 * empties. Pure given its inputs — same store + policy + seeds, same
 * reconstruction.
 */
export const reconstruct = (store: CaveStore, policy: Policy, seeds: readonly string[]): Reconstruction => {
  let state: State = {
    frontier: seeds.map(entity => ({ entity, score: 1, depth: 0 })),
    visited: new Set(),
    collected: [],
    steps: 0
  }
  const seen = new Set<string>()
  const claims: Claim.t[] = []
  const trace: Step[] = []

  const collect = (about: readonly Claim.t[]): number => {
    let added = 0
    for (const claim of about) {
      const key = Key.of(claim)
      if (!seen.has(key)) {
        seen.add(key)
        claims.push(claim)
        added += 1
      }
    }
    return added
  }

  while (!policy.done(state)) {
    const cue = policy.select(state)
    if (cue === undefined) {
      break
    }
    const visited = new Set(state.visited)
    visited.add(cue.entity)
    const collected = collect(store.claimsAbout(cue.entity))
    // Route: relational edges both ways plus topic containment (spec §11.3).
    const edges = [...store.forward(cue.entity), ...store.reverse(cue.entity)]
    const neighbors = new Map<string, Cue>()
    const offer = (entity: string, score: number, depth: number): void => {
      if (visited.has(entity)) {
        return
      }
      const existing = neighbors.get(entity)
      if (existing === undefined || existing.score < score) {
        neighbors.set(entity, { entity, score, depth })
      }
    }
    for (const edge of edges) {
      offer(edge.to, policy.score(edge, cue), cue.depth + 1)
    }
    // Merge offers into the frontier keeping the maximum score per entity:
    // a weaker path discovered later must never downgrade a pending cue,
    // or adding knowledge could remove reachable claims.
    const merged: Cue[] = []
    for (const entry of state.frontier) {
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
    state = {
      frontier: merged,
      visited,
      collected: claims,
      steps: state.steps + 1
    }
    trace.push({ step: state.steps, cue, edges, collected })
  }

  return { claims, trace, state }
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
 * edge confidence × decay, hard budgets for steps and claims.
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
