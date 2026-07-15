/**
 * Reconstruction (loop) cases — spec §18 evaluation.
 *
 * A case whose golden has a `<stem>.loop.cave` sibling evals the
 * §18 reconstruction loop instead of extraction: the source is the
 * *knowledge* (CAVE text), the loop file declares the seeds and budgets,
 * and the golden is the claims a good reconstruction collects. Without an
 * agent the deterministic heuristic policy runs — the baseline every LLM
 * policy is measured against; with `--agent` the same seeds drive
 * `llmPolicy` over the shell-agent template (one completion per step).
 *
 * The loop file is ordinary CAVE text about the entity `loop` — the
 * existing parser, no new grammar:
 *
 * ```cave
 * loop SEEDS reject-valid-tokens
 * loop HAS query: `why are valid tokens rejected?`
 * loop HAS steps: 12
 * loop HAS claims: 40
 * ```
 *
 * `SEEDS` claims keep file order (the initial frontier); `query`, `steps`
 * and `claims` are attributes — several claims on one attribute follow
 * belief semantics, the last wins. Anything else in the file is a fixture
 * problem: a misspelled knob must scream, not silently default.
 */

import { Claim } from '@cavelang/core'
import { canonicalizeText } from '@cavelang/canonical'
import type { Registry } from '@cavelang/canonical'
import {
  heuristicPolicy, llmPolicy, memoryStoreOfText, reconstruct, reconstructAsync, shellComplete
} from '@cavelang/loop'
import type { Reconstruction } from '@cavelang/loop'

export type Spec = {
  /** Seed entities, in file order — the initial frontier. */
  readonly seeds: readonly string[]
  /** Shown to the LLM policy each step; the heuristic ignores it. */
  readonly query?: string
  /** Step budget for both policies (their shared default when absent). */
  readonly maxSteps?: number
  /** Claim budget for both policies. */
  readonly maxClaims?: number
}

const subject = 'loop'
const seedVerb = 'SEEDS'
const budgetAttributes = ['steps', 'claims'] as const

/**
 * Parses and strictly validates a loop file. Problems are fixture
 * problems — an unknown verb, subject or attribute fails the case
 * instead of being skipped.
 */
export const parseSpec = (
  text: string,
  registry: Registry.t
): { spec: Spec, problems: readonly string[] } => {
  const result = canonicalizeText(text, registry)
  const problems: string[] = result.problems.map(problem => `loop line ${problem.line}: ${problem.message}`)
  const seeds: string[] = []
  let query: undefined | string
  const budgets = new Map<string, number>()
  for (const { claim, line } of result.claims) {
    const problem = (message: string): void => {
      problems.push(`loop line ${line}: ${message}`)
    }
    if (Claim.formatTerm(claim.subject) !== subject) {
      problem(`expected subject '${subject}', got '${Claim.formatTerm(claim.subject)}'`)
      continue
    }
    if (claim.verb === seedVerb && claim.payload.kind === 'relation') {
      const seed = Claim.formatTerm(claim.payload.object)
      if (!seeds.includes(seed)) {
        seeds.push(seed)
      }
      continue
    }
    if (claim.verb === 'HAS' && claim.payload.kind === 'attribute') {
      const { attribute, value } = claim.payload
      if (attribute === 'query') {
        query = value.raw
        continue
      }
      if ((budgetAttributes as readonly string[]).includes(attribute)) {
        if (value.num === undefined || !Number.isInteger(value.num) || value.num < 1) {
          problem(`${attribute} must be a positive integer, got '${value.raw}'`)
        } else {
          budgets.set(attribute, value.num)
        }
        continue
      }
      problem(`unknown attribute '${attribute}' — expected query, steps or claims`)
      continue
    }
    problem(`expected '${subject} ${seedVerb} <entity>' or '${subject} HAS query|steps|claims: …'`)
  }
  if (seeds.length === 0) {
    problems.push(`loop file declares no seeds — at least one '${subject} ${seedVerb} <entity>' line is required`)
  }
  const steps = budgets.get('steps')
  const claims = budgets.get('claims')
  return {
    spec: {
      seeds,
      ...query === undefined ? {} : { query },
      ...steps === undefined ? {} : { maxSteps: steps },
      ...claims === undefined ? {} : { maxClaims: claims }
    },
    problems
  }
}

/** The agent contract of one reconstruction run: prompt in, reply out. */
export type Complete = (prompt: string) => Promise<string>

export type RunOptions = {
  /** Shell-agent template or completion function; absent = the heuristic baseline. */
  readonly agent?: string | Complete
  readonly timeoutSeconds?: number
  readonly cwd?: string
}

/**
 * Runs one reconstruction over the knowledge: the heuristic baseline
 * without an agent, `llmPolicy` over the agent otherwise. Both policies
 * get the same budgets, so their scores compare like for like.
 */
export const runSpec = (
  knowledge: string,
  spec: Spec,
  registry: Registry.t,
  options: RunOptions = {}
): Promise<Reconstruction> => {
  const store = memoryStoreOfText(knowledge, registry)
  const budgets = {
    ...spec.maxSteps === undefined ? {} : { maxSteps: spec.maxSteps },
    ...spec.maxClaims === undefined ? {} : { maxClaims: spec.maxClaims }
  }
  if (options.agent === undefined) {
    return Promise.resolve(reconstruct(store, heuristicPolicy(budgets), spec.seeds))
  }
  const complete = typeof options.agent === 'function' ?
    options.agent :
    shellComplete(options.agent, {
      ...options.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds },
      ...options.cwd === undefined ? {} : { cwd: options.cwd }
    })
  const policy = llmPolicy(complete, {
    ...spec.query === undefined ? {} : { query: spec.query },
    ...budgets
  })
  return reconstructAsync(store, policy, spec.seeds)
}

/** One-line expansion summary for run notes: `a → b → c`. */
export const traceNote = (reconstruction: Reconstruction): string =>
  `expanded ${reconstruction.trace.length} cue(s): ` +
  `${reconstruction.trace.map(step => step.cue.entity).join(' → ') || 'none'}`
