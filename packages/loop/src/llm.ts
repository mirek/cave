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
 *   signal. `done` then only enforces the hard budgets, for free.
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

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitClaim } from '@cavelang/canonical'
import type { AsyncPolicy, Cue, State } from './reconstruct.ts'

/** Minimal completion function the policy needs: prompt in, reply out. */
export type Complete = (prompt: string) => Promise<string>

export type LlmOptions = {
  /** What the reconstruction should answer — shown to the model each step. */
  readonly query?: string
  /** Extra guidance appended to every step prompt. */
  readonly instructions?: string
  /** Hard step budget — and completion budget, one per step (default 16). */
  readonly maxSteps?: number
  /** Stop once this many claims are collected (default ∞). */
  readonly maxClaims?: number
  /** Per-hop decay of the local edge score (default 0.8). */
  readonly decay?: number
  /** Strongest frontier cues offered to the model per step (default 16). */
  readonly maxCues?: number
}

/** The reply that ends the reconstruction. */
export const stopToken = 'STOP'

const defaultMaxCues = 16

/** Strongest first; stable sort keeps FIFO order on ties, like the heuristic. */
const strongestFirst = (frontier: readonly Cue[]): Cue[] =>
  [...frontier].sort((a, b) => b.score - a.score)

/**
 * The single per-step prompt: the query, the claims collected so far as
 * canonical CAVE lines, the strongest frontier cues with their scores, and
 * the reply protocol. Exported for tests and for adapter authors who want
 * the same rendering under a different transport.
 */
export const selectPrompt = (state: State, options: LlmOptions = {}): string => {
  const cues = strongestFirst(state.frontier).slice(0, options.maxCues ?? defaultMaxCues)
  return [
    'You are driving memory reconstruction over a CAVE claim graph, one step at a time.',
    ...options.query === undefined ? [] : ['', `Query: ${options.query}`],
    '',
    'Claims collected so far (canonical CAVE):',
    ...state.collected.length === 0 ? ['(none yet)'] : state.collected.map(claim => emitClaim(claim)),
    '',
    'Frontier cues (entity @ score); expanding a cue collects its claims and its neighbors:',
    ...cues.map(cue => `${cue.entity} @ ${cue.score.toFixed(2)}`),
    ...options.instructions === undefined ? [] : ['', options.instructions],
    '',
    'Reply with exactly one line: the name of the single frontier cue to expand next, ' +
      `or ${stopToken} when the collected claims already answer the query ` +
      '(or nothing on the frontier would help).'
  ].join('\n')
}

/** List markers, punctuation, quotes and backticks around a model's answer. */
const stripped = (line: string): string =>
  line.trim()
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/[.!,;:]+$/, '')
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .trim()

const wordChar = /[A-Za-z0-9_/-]/

/** First occurrence of `entity` in `reply` not embedded in a larger word. */
const mentionAt = (reply: string, entity: string): number => {
  for (let from = 0; ; ) {
    const index = reply.indexOf(entity, from)
    if (index === -1) {
      return -1
    }
    const before = index === 0 ? undefined : reply[index - 1]
    const after = index + entity.length >= reply.length ? undefined : reply[index + entity.length]
    if ((before === undefined || !wordChar.test(before)) && (after === undefined || !wordChar.test(after))) {
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
  for (const candidate of [reply.trim(), lastLine, stripped(lastLine), stripped(reply)]) {
    const exact = byEntity.get(candidate)
    if (exact !== undefined) {
      return exact
    }
  }
  if (new RegExp(`^${stopToken}\\b`, 'i').test(reply.trim())) {
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
  if (new RegExp(`\\b${stopToken}\\b`, 'i').test(reply)) {
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
  return {
    async select(state) {
      if (state.frontier.length === 0) {
        return undefined
      }
      return parseSelection(await complete(selectPrompt(state, options)), state.frontier)
    },
    async score(edge, from) {
      return from.score * edge.conf * decay
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
  const timeoutSeconds = options.timeoutSeconds ?? 120
  return prompt => new Promise((resolvePromise, rejectPromise) => {
    let dir: undefined | string
    let command = template
    if (template.includes('{prompt-file}')) {
      dir = mkdtempSync(join(tmpdir(), 'cave-loop-'))
      const file = join(dir, 'prompt.md')
      writeFileSync(file, prompt)
      // Quoted like ingest's substitutions — one argument, never re-parsed.
      command = template.replaceAll('{prompt-file}', `'${file.replaceAll("'", `'\\''`)}'`)
    }
    let settled = false
    const settle = (finish: () => void): void => {
      if (!settled) {
        settled = true
        if (dir !== undefined) {
          rmSync(dir, { recursive: true, force: true })
        }
        // Grandchildren of a killed shell can inherit the stdio pipes;
        // dropping our end releases the event loop from waiting on them.
        child.stdout.destroy()
        child.stdin.destroy()
        finish()
      }
    }
    const child = spawn(command, {
      shell: true,
      timeout: timeoutSeconds * 1000,
      stdio: ['pipe', 'pipe', 'inherit'],
      ...options.cwd === undefined ? {} : { cwd: options.cwd }
    })
    let stdout = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.on('error', error => settle(() => rejectPromise(new Error(`agent failed: ${error.message}`))))
    // A killed shell can leave grandchildren holding the stdio pipes open,
    // so the signal path settles on `exit` — waiting for `close` would wait
    // for processes the timeout was meant to cut loose.
    child.on('exit', (_code, signal) => {
      if (signal !== null) {
        settle(() => rejectPromise(new Error(`agent killed by ${signal} after ${timeoutSeconds}s`)))
      }
    })
    child.on('close', code => settle(() => {
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        rejectPromise(new Error(`agent exited with ${code}`))
      }
    }))
    child.stdin.on('error', () => {})
    child.stdin.write(prompt)
    child.stdin.end()
  })
}
