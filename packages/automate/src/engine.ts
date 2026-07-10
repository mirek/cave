/**
 * The settle engine (spec §29.2–§29.4) — evaluates every current
 * automation against the store's change feed and runs the steps of the
 * solutions that fire.
 *
 * - Triggers join exactly like rules and actions (§24.2's left-to-right
 *   join over current positive beliefs); a solution **fires** only when
 *   it cites at least one *event row* — a premise row newer than the
 *   automation's watermark that is neither engine bookkeeping
 *   (`src:cave-automate` / `src:cave-derive` / `src:cave-act`) nor the
 *   automation's own output (`src:automation/<name>`, or `src:action/<x>`
 *   for its action steps). An automation is deaf to its own echo; other
 *   automations' output triggers normally, which is how automations chain.
 * - An automation with no stored watermark is armed at its declaration
 *   row's tx — it watches from the moment it is declared (§29.2).
 * - Firing records the batch *before* acting on it (§29.3): one
 *   `automate-watermark` append (the firing log), then the steps per
 *   solution in declaration order — re-runs never re-notify the world.
 * - One `settle` call is a cycle: passes run derivation (§24, opt-out)
 *   then every automation, until nothing fires — steps append, the next
 *   pass sees the new rows, and idempotent write paths make chains
 *   converge (§29.4).
 */

import { spawnSync } from 'node:child_process'
import { Context, Key } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { act, loadAction, shellQuote } from '@cavelang/act'
import { match } from '@cavelang/query'
import { derive, satisfies, specialize } from '@cavelang/rules'
import { Row, type Store } from '@cavelang/store'
import * as Automation from './automation.ts'
import { bookkeepingKey, loadAutomations, provenanceContext, type LoadProblem } from './declare.ts'

/** Attribute of per-automation watermark claims (spec §29.2). */
export const watermarkAttribute = 'automate-watermark'

export const defaultMaxPasses = 20

export const defaultAgentTimeoutSeconds = 120

/** Engine bookkeeping sources — never event rows (spec §29.2). */
const infrastructureSources: readonly string[] = ['src:cave-automate', 'src:cave-derive', 'src:cave-act']

export type SettleOptions = {
  /** Premises match through the alias closure (spec §13.6). */
  readonly aliases?: boolean
  /** Fire the store's rules each pass (spec §29.4) — on by default. */
  readonly derive?: boolean
  /** Shape gate for action steps (spec §25.3) — on by default. */
  readonly check?: boolean
  /** Out-of-band hook command templates by name (spec §25.4). */
  readonly hooks?: Readonly<Record<string, string>>
  /** Out-of-band agent for prompt steps — the shell contract's completion. */
  readonly complete?: (prompt: string) => Promise<string>
  /** Cycle guard — maximum passes before giving up on quiescence. */
  readonly maxPasses?: number
  /** Working directory for hook commands. */
  readonly cwd?: string
  /** Hook wall-clock budget in seconds (default 600, like §25.4). */
  readonly hookTimeoutSeconds?: number
}

export type StepOutcome = {
  /** Normalized step text — `action/<x>`, `hook/<y>`, or the prompt literal. */
  readonly step: string
  readonly kind: Automation.Step['kind']
  /** `not-configured` is a legitimate, side-effect-free mode (§25.4, §29.3). */
  readonly outcome: 'ok' | 'failed' | 'not-configured'
  /** Claims the step appended or updated (action effects, agent reply). */
  readonly appended?: number
  readonly detail?: string
}

export type FiringOutcome = {
  readonly bindings: Readonly<Record<string, string>>
  readonly steps: StepOutcome[]
}

export type AutomationOutcome = {
  /** Declaration subject, `automation/<name>`. */
  readonly subject: string
  readonly name: string
  readonly text: string
  readonly description?: string
  evaluations: number
  /** Firing solutions across the cycle's passes. */
  fired: number
  readonly firings: FiringOutcome[]
}

export type DeriveTotals = {
  passes: number
  appended: number
  updated: number
  retracted: number
  unchanged: number
}

export type SettleReport = {
  readonly passes: number
  readonly automations: readonly AutomationOutcome[]
  /** Stored declarations that failed to parse — reported, skipped. */
  readonly problems: readonly LoadProblem[]
  /** Accumulated §24 derivation counts, absent under `derive: false`. */
  readonly derive?: DeriveTotals
  readonly notes: readonly string[]
}

/** `true` when the report contains a failed step or a parse problem. */
export const settled = (report: SettleReport): boolean =>
  report.problems.length === 0 &&
  report.automations.every(automation =>
    automation.firings.every(firing => firing.steps.every(step => step.outcome !== 'failed')))

type Solution = {
  readonly bindings: Readonly<Record<string, string>>
  readonly rows: readonly Row.t[]
}

const maxTx = (store: Store): undefined | string =>
  (store.db.prepare('SELECT MAX(tx) AS t FROM cave_claim').get() as { t: null | string }).t ?? undefined

/** The §24.2 join with no pre-bound parameters — the trigger evaluation. */
const evaluateTrigger = (store: Store, automation: Automation.t, aliases: boolean): Solution[] => {
  let solutions: Solution[] = [{ bindings: {}, rows: [] }]
  for (const premise of automation.premises) {
    if (premise.kind === 'constraint') {
      solutions = solutions.filter(solution =>
        satisfies(solution.bindings[premise.variable], premise.op, premise.value))
    } else {
      solutions = solutions.flatMap(solution => {
        const pattern = specialize(premise.pattern, solution.bindings)
        if (pattern === undefined) {
          return []
        }
        return match(store, pattern, { aliases }).map(found => ({
          bindings: { ...solution.bindings, ...found.bindings },
          rows: found.row === undefined ? solution.rows : [...solution.rows, found.row]
        }))
      })
    }
    if (solutions.length === 0) {
      break
    }
  }
  return solutions
}

/**
 * Sources whose rows an automation must not treat as events — its own
 * agent replies and the effects of its own action steps (spec §29.2).
 */
const echoSources = (automation: Automation.t): string[] => [
  Context.source(automation.subject),
  ...automation.steps.flatMap(step =>
    step.kind === 'action' ? [Context.source(`action/${step.name}`)] : [])
]

/**
 * Raw text of a stored binding — literal delimiters stripped, so values
 * read naturally in prompts and hook placeholders and round-trip through
 * the §25.2 argument formatting.
 */
const rawBinding = (bound: string): string =>
  Row.parseValue(bound).raw

/** Substitutes bound `?var`s into a prompt template, longest name first. */
export const substitutePrompt = (template: string, bindings: Readonly<Record<string, string>>): string => {
  let text = template
  for (const name of Object.keys(bindings).sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    text = text.replace(new RegExp(`\\?${escaped}(?![A-Za-z0-9_-])`, 'g'), rawBinding(bindings[name]!))
  }
  return text
}

/**
 * Substitutes `{automation}` and `{<var>}` placeholders in one pass —
 * every value shell-quoted, never spliced raw (§25.4's rule); unknown
 * placeholders stay.
 */
export const substituteHook = (
  template: string,
  automation: string,
  bindings: Readonly<Record<string, string>>
): string =>
  template.replace(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g, (whole, name: string) =>
    name === 'automation' ? shellQuote(automation) :
    bindings[name] !== undefined ? shellQuote(rawBinding(bindings[name]!)) :
    whole)

/** Canonical lines of a solution's premise rows, deduplicated, join order. */
const solutionLines = (store: Store, solution: Solution): string[] => {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const row of solution.rows) {
    if (!seen.has(row.id)) {
      seen.add(row.id)
      lines.push(Canonical.emitClaim(store.toClaim(row)))
    }
  }
  return lines
}

/** The engine-built prompt around one instantiated template (spec §29.3). */
export const buildPrompt = (
  automation: Automation.t,
  description: undefined | string,
  instruction: string,
  claims: readonly string[]
): string => `You are the agent step of the CAVE automation "${automation.name}"${description === undefined ? '' : ` — ${description}`}.

Instruction:
${instruction}

Triggering claims (current beliefs matched by the trigger):
\`\`\`cave
${claims.join('\n')}
\`\`\`

Reply with CAVE claim lines to record in the store — they are appended
stamped @src:${automation.subject}, and a line equal to current belief is
skipped. Reply with nothing to record nothing. Output only CAVE lines.`

const runAction = (store: Store, step: Automation.Step & { kind: 'action' }, solution: Solution, options: SettleOptions): StepOutcome => {
  const resolved = loadAction(store, step.name)
  if (resolved === undefined) {
    return { step: step.text, kind: 'action', outcome: 'failed', detail: `no current action "action/${step.name}" — declare it first (spec §25.1)` }
  }
  if (resolved.loaded === undefined) {
    return { step: step.text, kind: 'action', outcome: 'failed', detail: `the declaration of "action/${step.name}" does not parse: ${resolved.problems.join('; ')}` }
  }
  const args: Record<string, string> = {}
  for (const param of resolved.loaded.action.params) {
    const bound = solution.bindings[param]
    if (bound === undefined) {
      return { step: step.text, kind: 'action', outcome: 'failed', detail: `the trigger did not bind ?${param} — action parameters bind from same-named trigger variables (spec §29.3)` }
    }
    args[param] = rawBinding(bound)
  }
  const report = act(store, step.name, args, {
    check: options.check !== false,
    aliases: options.aliases === true,
    ...options.hooks === undefined ? {} : { hooks: options.hooks },
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    ...options.hookTimeoutSeconds === undefined ? {} : { hookTimeoutSeconds: options.hookTimeoutSeconds }
  })
  if (!report.ok) {
    return { step: step.text, kind: 'action', outcome: 'failed', detail: report.error }
  }
  const hook = report.hook !== undefined && report.hook.error !== undefined ? `; hook ${report.hook.name}: ${report.hook.error}` : ''
  return {
    step: step.text,
    kind: 'action',
    outcome: hook === '' ? 'ok' : 'failed',
    appended: report.appended + report.updated,
    detail: `+${report.appended} appended, ${report.updated} updated, ${report.unchanged} unchanged${hook}`
  }
}

const runHook = (name: string, automation: Automation.t, solution: Solution, lines: readonly string[], options: SettleOptions): StepOutcome => {
  const step = `hook/${name}`
  const template = options.hooks?.[name]
  if (template === undefined) {
    return { step, kind: 'hook', outcome: 'not-configured', detail: 'hook not configured (spec §25.4)' }
  }
  const command = substituteHook(template, automation.name, solution.bindings)
  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    input: `${lines.join('\n')}\n`,
    timeout: (options.hookTimeoutSeconds ?? 600) * 1000,
    ...options.cwd === undefined ? {} : { cwd: options.cwd }
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const error =
    result.error !== undefined ? result.error.message :
    result.status !== 0 ? `hook exited with ${result.status ?? `signal ${result.signal}`}` :
    undefined
  const detail =
    error !== undefined ? `${error}${output === '' ? '' : ` — ${output}`}` :
    output === '' ? undefined : output
  return {
    step,
    kind: 'hook',
    outcome: error === undefined ? 'ok' : 'failed',
    ...detail === undefined ? {} : { detail }
  }
}

/**
 * Appends an agent reply (spec §29.3): lenient parse, `@src:automation/<name>`
 * stamp, and the §24.4 idempotency convention per claim — a reply claim
 * equal to its current belief appends nothing (claims cited by qualifier
 * edges are kept, so reply structure survives).
 */
export const appendReply = (store: Store, automation: Automation.t, reply: string): { appended: number, problems: string[] } => {
  const result = Canonical.canonicalizeText(reply, store.registry())
  const problems = result.problems.map(problem => `reply line ${problem.line}: ${problem.message}`)
  const referenced = new Set<number>()
  for (const edge of result.edges) {
    referenced.add(edge.parent)
    referenced.add(edge.child)
  }
  const keep: number[] = []
  result.claims.forEach((entry, index) => {
    const stamped = Context.hasSource(entry.claim.contexts) ?
      entry.claim :
      { ...entry.claim, contexts: [...entry.claim.contexts, Context.source(automation.subject)] }
    const current = store.currentBelief(Key.of(stamped))
    const columns = Row.toColumns(entry.claim)
    const unchanged = current !== undefined && Math.abs(current.conf - entry.claim.conf) < 1e-9 &&
      current.value_text === columns.valueText
    if (!unchanged || referenced.has(index)) {
      keep.push(index)
    }
  })
  if (keep.length === 0) {
    return { appended: 0, problems }
  }
  const remap = new Map(keep.map((old, at) => [old, at]))
  const inserted = store.insertResult({
    claims: keep.map(index => result.claims[index]!),
    edges: result.edges.map(edge => ({ parent: remap.get(edge.parent)!, role: edge.role, child: remap.get(edge.child)! })),
    registry: result.registry,
    problems: []
  }, { source: automation.subject })
  return { appended: inserted.ids.length, problems }
}

const runPrompt = async (
  store: Store,
  step: Automation.Step & { kind: 'prompt' },
  automation: Automation.t,
  description: undefined | string,
  solution: Solution,
  lines: readonly string[],
  options: SettleOptions
): Promise<StepOutcome> => {
  if (options.complete === undefined) {
    return { step: step.text, kind: 'prompt', outcome: 'not-configured', detail: 'no agent configured (--agent, spec §29.3)' }
  }
  const prompt = buildPrompt(automation, description, substitutePrompt(step.template, solution.bindings), lines)
  let reply: string
  try {
    reply = await options.complete(prompt)
  } catch (error) {
    return { step: step.text, kind: 'prompt', outcome: 'failed', detail: error instanceof Error ? error.message : String(error) }
  }
  if (reply.trim() === '') {
    return { step: step.text, kind: 'prompt', outcome: 'ok', appended: 0, detail: 'empty reply — nothing recorded' }
  }
  const { appended, problems } = appendReply(store, automation, reply)
  return {
    step: step.text,
    kind: 'prompt',
    outcome: 'ok',
    appended,
    detail: `+${appended} claim(s)${problems.length === 0 ? '' : `; ${problems.join('; ')}`}`
  }
}

/**
 * One settle cycle (spec §29.4): passes of derivation + trigger
 * evaluation until nothing fires, bounded by `maxPasses`. Firing appends
 * the watermark before running steps (§29.3); step failures are reported
 * in the outcome and never abort the cycle.
 */
export const settle = async (store: Store, options: SettleOptions = {}): Promise<SettleReport> => {
  const aliases = options.aliases === true
  const maxPasses = options.maxPasses ?? defaultMaxPasses
  const outcomes = new Map<string, AutomationOutcome>()
  const problems = new Map<string, LoadProblem>()
  const notes: string[] = []
  const deriveTotals: DeriveTotals = { passes: 0, appended: 0, updated: 0, retracted: 0, unchanged: 0 }
  const anyRowSince = store.db.prepare('SELECT 1 AS hit FROM cave_claim WHERE tx > ? LIMIT 1')

  let passes = 0
  let progress = true
  while (progress && passes < maxPasses) {
    passes += 1
    progress = false

    if (options.derive !== false) {
      const report = derive(store, { aliases })
      deriveTotals.passes += report.passes
      deriveTotals.appended += report.appended
      deriveTotals.updated += report.updated
      deriveTotals.retracted += report.retracted
      deriveTotals.unchanged += report.unchanged
      for (const problem of report.problems) {
        const note = `${problem.subject}: ${problem.problems.join('; ')}`
        if (!notes.includes(note)) {
          notes.push(note)
        }
      }
      if (report.appended + report.updated + report.retracted > 0) {
        progress = true
      }
    }

    const loaded = loadAutomations(store)
    for (const problem of loaded.problems) {
      problems.set(problem.subject, problem)
    }
    for (const entry of loaded.loaded) {
      const { automation, row, description } = entry
      let outcome = outcomes.get(automation.subject)
      if (outcome === undefined) {
        outcome = {
          subject: automation.subject,
          name: automation.name,
          text: automation.text,
          ...description === undefined ? {} : { description },
          evaluations: 0,
          fired: 0,
          firings: []
        }
        outcomes.set(automation.subject, outcome)
      }

      // Arming (spec §29.2): the stored watermark, else the declaration tx.
      const stored = store.currentBelief(bookkeepingKey(automation.subject, watermarkAttribute))
      const mark = stored !== undefined && stored.conf > 0 && stored.value_text !== null ?
        stored.value_text :
        row.tx
      if (anyRowSince.get(mark) === undefined) {
        continue
      }

      outcome.evaluations += 1
      const solutions = evaluateTrigger(store, automation, aliases)
      const excluded = new Set([...infrastructureSources, ...echoSources(automation)])
      const isEvent = (premiseRow: Row.t): boolean =>
        premiseRow.tx > mark &&
        !store.toClaim(premiseRow).contexts.some(context => excluded.has(context))
      const firing = solutions.filter(solution => solution.rows.some(isEvent))
      if (firing.length === 0) {
        continue
      }

      // Record the batch before acting on it (spec §29.3): the watermark
      // append is the firing log, and a re-run never re-notifies.
      const boundary = maxTx(store)!
      const stepCount = firing.length * automation.steps.length
      store.ingest(
        `${automation.subject} HAS ${watermarkAttribute}: ${boundary} @${provenanceContext} ` +
        `; fired ${firing.length} solution(s), ${stepCount} step(s)`)
      progress = true
      outcome.fired += firing.length

      for (const solution of firing) {
        const lines = solutionLines(store, solution)
        const firingOutcome: FiringOutcome = { bindings: solution.bindings, steps: [] }
        outcome.firings.push(firingOutcome)
        for (const step of automation.steps) {
          switch (step.kind) {
            case 'action':
              firingOutcome.steps.push(runAction(store, step, solution, options))
              break
            case 'hook':
              firingOutcome.steps.push(runHook(step.name, automation, solution, lines, options))
              break
            case 'prompt':
              firingOutcome.steps.push(await runPrompt(store, step, automation, description, solution, lines, options))
              break
          }
        }
      }
    }
  }

  if (passes >= maxPasses && progress) {
    notes.push(`stopped at ${maxPasses} passes before settling — re-run to continue, or raise maxPasses (spec §29.4)`)
  }
  return {
    passes,
    automations: [...outcomes.values()],
    problems: [...problems.values()],
    ...options.derive === false ? {} : { derive: deriveTotals },
    notes
  }
}
