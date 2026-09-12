/**
 * LLM-driven policy (spec §18) — the model makes the
 * select/stop decisions; the loop stays unchanged.
 *
 * The deterministic heuristic in `reconstruct.ts` spends no tokens and is
 * the eval baseline (`cave eval` runs it when no agent is given); this
 * policy spends one completion per step and should earn its cost by
 * reading the claims. Design decisions:
 *
 * - **One completion per step.** The sketch this file grew from asked the
 *   model twice per step (select, then "are we done?"). Both decisions fit
 *   one prompt: the model replies with the next cue to expand *or* `STOP`,
 *   and the loop already treats an `undefined` selection as the stop
 *   signal. `done` then only checks the stopping budgets, for free.
 * - **Scoring stays local.** Models are better spent on select/stop than
 *   on per-edge arithmetic; `score` is the same parent × confidence ×
 *   decay the heuristic uses, so the scores shown in the prompt mean the
 *   same thing in both policies.
 * - **Claims render as canonical CAVE text** (`emitClaim`) — compact,
 *   line-oriented, and exactly the notation the model knows from the spec
 *   card and the MCP server instructions.
 * - **Replies parse leniently, and degrade to the heuristic.** An answer
 *   that names no frontier cue and never says stop expands the strongest
 *   cue instead of silently ending the reconstruction — the budgets bound
 *   the damage, and the result stays useful.
 *
 * The model itself stays out-of-band (spec §19.5): `shellComplete` adapts
 * any shell-agent command template — the same `--agent` contract
 * `cave ingest` and `cave eval` use — into a `Complete`, so no LLM SDK
 * ever becomes a dependency of this package.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitClaim } from '@cavelang/canonical'
import type { AsyncPolicy, Cue, State } from './reconstruct.ts'
import { runProcess, shellCommand } from './process.ts'
import { validateBudgets } from './budgets.ts'
import { propagatedScore, validateScoreSetting } from './score-settings.ts'
import { completionTimeoutMs } from './timeout.ts'

/** Minimal completion function the policy needs: prompt in, reply out. */
export type Complete = (prompt: string) => Promise<string>

export type LlmOptions = {
  /** What the reconstruction should answer — shown to the model each step. */
  readonly query?: string
  /** Extra guidance appended to every step prompt. */
  readonly instructions?: string
  /** Hard step budget — and completion budget, one per step (default 16). */
  readonly maxSteps?: number
  /** Claim-count stopping threshold, checked between complete expansions (default ∞). */
  readonly maxClaims?: number
  /** Per-hop decay of the local edge score (default 0.8). */
  readonly decay?: number
  /** Strongest frontier cues offered to the model per step (default 16). */
  readonly maxCues?: number
}

/** The reply that ends the reconstruction. */
export const stopToken = 'STOP'

const defaultMaxCues = 16

const cueLimit = (maxCues = defaultMaxCues): number => {
  if (!Number.isSafeInteger(maxCues) || maxCues < 1) {
    throw new TypeError('maxCues must be a positive safe integer')
  }
  return maxCues
}

/** Strongest first; stable sort keeps FIFO order on ties, like the heuristic. */
const strongestFirst = (frontier: readonly Cue[]): Cue[] =>
  [...frontier].sort((a, b) => b.score - a.score)

/** Keep familiar hundredths when exact without erasing distinctions used by selection. */
const scoreText = (score: number): string => {
  const rounded = score.toFixed(2)
  return Number(rounded) === score ? rounded : String(score)
}

/**
 * The single per-step prompt: the query, the claims collected so far as
 * canonical CAVE lines, the strongest frontier cues with their scores, and
 * the reply protocol. Exported for tests and for adapter authors who want
 * the same rendering under a different transport.
 */
export const selectPrompt = (state: State, options: LlmOptions = {}): string => {
  const maxCues = cueLimit(options.maxCues)
  const query = options.query
  const instructions = options.instructions
  const cues = strongestFirst(state.frontier).slice(0, maxCues)
  return [
    'You are driving memory reconstruction over a CAVE claim graph, one step at a time.',
    ...query === undefined ? [] : ['', `Query: ${query}`],
    '',
    'Claims collected so far (canonical CAVE):',
    ...state.collected.length === 0 ? ['(none yet)'] : state.collected.map(claim => emitClaim(claim)),
    '',
    'Frontier cues (entity @ score); expanding a cue collects its claims and its neighbors:',
    ...cues.map(cue => `${cue.entity} @ ${scoreText(cue.score)}`),
    ...instructions === undefined ? [] : ['', instructions],
    '',
    'Reply with exactly one line: the name of the single frontier cue to expand next, ' +
      `or ${stopToken} when the collected claims already answer the query ` +
      '(or nothing on the frontier would help).'
  ].join('\n')
}

/** List markers, punctuation, quotes and backticks around a model's answer. */
const unlisted = (line: string): string => line.trim().replace(/^(?:[-*]|\d+[.)])\s+/, '')

const stripped = (line: string): string =>
  unlisted(line)
    .replace(/[.!,;:]+$/, '')
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .trim()

const wordChars = String.raw`[\p{L}\p{M}\p{N}_/-]`
const startsWithWord = new RegExp(`^${wordChars}`, 'u')
// Dots and colons connect name segments only when another word character
// follows on that side; sentence punctuation such as `api. ` stays a boundary.
const continuesName = (reply: string, boundary: number, direction: -1 | 1): boolean => {
  let index = boundary
  while (/[.:]/.test(reply[direction === -1 ? index - 1 : index] ?? '')) {
    index += direction
  }
  // Two code units preserve an adjacent astral code point on either side.
  const adjacent = direction === -1
    ? [...reply.slice(Math.max(0, index - 2), index)].at(-1) ?? ''
    : reply.slice(index, index + 2)
  return startsWithWord.test(adjacent)
}

/** First occurrence of `entity` in `reply` not embedded in a larger word. */
const mentionAt = (reply: string, entity: string): number => {
  // Empty names can match exact replies, but cannot be mentioned in prose.
  // indexOf('', from) clamps to reply.length, so advancing from never ends.
  if (entity === '') return -1
  for (let from = 0; ; ) {
    const index = reply.indexOf(entity, from)
    if (index === -1) {
      return -1
    }
    const end = index + entity.length
    if (!continuesName(reply, index, -1) && !continuesName(reply, end, 1)) {
      return index
    }
    from = index + 1
  }
}

/**
 * Decides what the model asked for. In order:
 *
 * 1. the trimmed reply, its last non-empty line, or either with list
 *    markers/quotes stripped, is exactly a frontier entity → that cue;
 *    trailing sentence punctuation prefers the longest matching literal name;
 * 2. the reply's first word is the stop token (any case) → stop;
 * 3. the earliest frontier entity mentioned anywhere in the reply → that
 *    cue (ties at one position go to the longer name; occurrences inside
 *    larger words don't count);
 * 4. the stop token appears as a word anywhere → stop;
 * 5. otherwise the strongest cue — an unparseable reply degrades to the
 *    heuristic instead of silently ending the reconstruction.
 */
export const parseSelection = (reply: string, frontier: readonly Cue[]): undefined | Cue => {
  if (frontier.length === 0) {
    return undefined
  }
  const byEntity = new Map(frontier.map(cue => [cue.entity, cue]))
  const lastLine = reply.split('\n').map(line => line.trim()).filter(line => line !== '').at(-1) ?? ''
  for (const candidate of [reply.trim(), lastLine, unlisted(lastLine), unlisted(reply), stripped(lastLine), stripped(reply)]) {
    let exact = byEntity.get(candidate)
    if (exact === undefined) {
      // Prefer a complete literal name before treating its suffix as punctuation.
      for (const cue of frontier) {
        if (candidate.startsWith(cue.entity) && /^[.!,;:]+$/.test(candidate.slice(cue.entity.length)) &&
            (exact === undefined || cue.entity.length > exact.entity.length)) exact = cue
      }
    }
    if (exact !== undefined) {
      return exact
    }
  }
  // Normalize only ASCII STOP spellings so case folding cannot move offsets.
  const stopAt = mentionAt(reply.trim().replace(/stop/gi, stopToken), stopToken)
  if (stopAt === 0) {
    return undefined
  }
  let mentioned: undefined | { cue: Cue, at: number }
  for (const cue of frontier) {
    const at = mentionAt(reply, cue.entity)
    if (at === -1) {
      continue
    }
    if (mentioned === undefined || at < mentioned.at ||
        (at === mentioned.at && cue.entity.length > mentioned.cue.entity.length)) {
      mentioned = { cue, at }
    }
  }
  if (mentioned !== undefined) {
    return mentioned.cue
  }
  if (stopAt !== -1) {
    return undefined
  }
  return strongestFirst(frontier)[0]
}

/**
 * The LLM-driven `AsyncPolicy` (spec §18): the model reads the collected
 * claims and the scored frontier, and answers with the next cue or
 * `STOP`; budgets stay local and completions cost one per step. Errors
 * from `complete` propagate — a failing agent must look like a failure,
 * not like a decision to stop.
 */
export const llmPolicy = (complete: Complete, options: LlmOptions = {}): AsyncPolicy => {
  const decay = options.decay ?? 0.8
  const maxSteps = options.maxSteps ?? 16
  const maxClaims = options.maxClaims ?? Number.POSITIVE_INFINITY
  validateBudgets(maxSteps, maxClaims)
  validateScoreSetting('decay', decay)
  const promptOptions = {
    query: options.query,
    instructions: options.instructions,
    maxCues: cueLimit(options.maxCues)
  }
  return {
    async select(state) {
      const frontier = state.frontier.map(({ entity, score, depth }) => ({ entity, score, depth }))
      if (frontier.length === 0) {
        return undefined
      }
      return parseSelection(await complete(selectPrompt({ ...state, frontier }, promptOptions)), frontier)
    },
    async score(edge, from) {
      return propagatedScore(from.score, edge.conf, decay)
    },
    async done(state) {
      return state.steps >= maxSteps || state.collected.length >= maxClaims
    }
  }
}

export type ShellCompleteOptions = {
  /** Seconds before the agent process is killed (default 120). */
  readonly timeoutSeconds?: number
  /** Working directory the agent runs in (default: the process cwd). */
  readonly cwd?: string
  /** Cancellation signal for the child process tree. */
  readonly signal?: AbortSignal
  /** Maximum captured reply bytes (default 8 MiB). */
  readonly maxStdoutBytes?: number
  /** Maximum captured diagnostic bytes (default 1 MiB). */
  readonly maxStderrBytes?: number
}

/**
 * A `Complete` from a shell-agent command template — the same contract as
 * `cave ingest --agent` and `cave eval --agent`: the prompt is piped to
 * stdin and substituted for `{prompt-file}` (written to a temporary file,
 * substituted shell-quoted) when the template names it; stdout is the
 * model's reply; stderr passes through; a non-zero exit, spawn failure or
 * timeout rejects.
 *
 * ```ts
 * const policy = llmPolicy(shellComplete(`claude -p`), { query })
 * ```
 */
export const shellComplete = (template: string, options: ShellCompleteOptions = {}): Complete => {
  const timeoutMs = completionTimeoutMs(options.timeoutSeconds ?? 120)
  const cwd = options.cwd
  const signal = options.signal
  const maxStdoutBytes = options.maxStdoutBytes
  const maxStderrBytes = options.maxStderrBytes
  return async prompt => {
    signal?.throwIfAborted()
    if (/[\uD800-\uDFFF]/u.test(prompt)) {
      throw new TypeError('agent prompt must contain well-formed Unicode')
    }
    let dir: undefined | string
    const failures: unknown[] = []
    const substitutions: Record<string, string> = {}
    try {
      if (template.includes('{prompt-file}')) {
        dir = mkdtempSync(join(tmpdir(), 'cave-loop-'))
        const file = join(dir, 'prompt.md')
        writeFileSync(file, prompt)
        substitutions['prompt-file'] = file
      }
      const result = await runProcess(shellCommand(template, substitutions), {
        strictStdoutUtf8: true,
        input: prompt,
        timeoutMs,
        ...cwd === undefined ? {} : { cwd },
        ...signal === undefined ? {} : { signal },
        ...maxStdoutBytes === undefined ? {} : { maxStdoutBytes },
        ...maxStderrBytes === undefined ? {} : { maxStderrBytes }
      })
      if (result.code !== 0) {
        throw new Error(`agent exited with ${result.code ?? `signal ${result.signal}`}`)
      }
      return result.stdout
    } catch (error) {
      failures.push(error)
      throw error
    } finally {
      if (dir !== undefined) {
        try { rmSync(dir, { recursive: true, force: true }) }
        catch (error) {
          if (failures.length === 0) throw error
          const describe = (value: unknown): string => {
            try { return value instanceof Error ? String(value.message) : String(value) }
            catch { return '[unprintable thrown value]' }
          }
          throw new AggregateError([failures[0], error],
            `${describe(failures[0])}; prompt cleanup also failed: ${describe(error)}`, { cause: failures[0] })
        }
      }
    }
  }
}
