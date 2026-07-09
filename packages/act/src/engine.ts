/**
 * Action execution (spec §25.2–§25.4) — the governed write path.
 *
 * `act` resolves the named action's current declaration, validates the
 * caller's arguments against its parameters, evaluates the premises over
 * current beliefs with the parameters pre-bound (the §24.2 left-to-right
 * join — a premise with no solution fails the action), and appends the
 * instantiated effects atomically:
 *
 * - effect confidence is the template's own — an action is the caller's
 *   assertion; premises are gates, not evidence (no noisy-AND, §25.2);
 * - appended rows are stamped `@src:action/<name>` (§9.5) and linked
 *   `BECAUSE` to the premise rows of the justifying solution and `VIA`
 *   to the declaration row (§24.3's obligations);
 * - execution is idempotent: an effect equal to its current belief
 *   appends nothing;
 * - the §20.3 shape gate runs by default — effects that introduce new
 *   `EXPECTS` violations roll the whole execution back (§25.3);
 * - after a commit that changed belief, a named-and-configured hook runs
 *   as a shell command — placeholders shell-quoted, appended claims on
 *   stdin, failures reported but never rolled back into the store
 *   (§25.4).
 */

import { spawnSync } from 'node:child_process'
import { Claim, Context, Key } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { Template } from '@cavelang/connect'
import { match } from '@cavelang/query'
import { boundTerm, satisfies, specialize } from '@cavelang/rules'
import { evaluate, violationKey, type Violation } from '@cavelang/shape'
import { Row, type Store } from '@cavelang/store'
import type { Ast } from '@cavelang/parser'
import * as Action from './action.ts'
import { currentHook, loadAction, type Loaded } from './declare.ts'

export type ActOptions = {
  /** Validate and report inside a rolled-back transaction; never fires hooks. */
  readonly dryRun?: boolean
  /** Shape gate (spec §25.3) — on by default; `false` skips the `EXPECTS` re-check. */
  readonly check?: boolean
  /** Premises match through the alias closure (spec §13.6). */
  readonly aliases?: boolean
  /** Out-of-band hook command templates by name (spec §25.4). */
  readonly hooks?: Readonly<Record<string, string>>
  /** Working directory for hook commands. */
  readonly cwd?: string
  /** Hook wall-clock budget (default 600 s). */
  readonly hookTimeoutSeconds?: number
}

export const defaultHookTimeoutSeconds = 600

export type EffectOutcome = {
  /** Canonical line of the instantiated effect. */
  readonly line: string
  readonly outcome: 'appended' | 'updated' | 'unchanged'
}

export type HookOutcome = {
  readonly name: string
  readonly fired: boolean
  /** Why the hook did not fire (`not configured`, `nothing changed`). */
  readonly note?: string
  readonly code?: null | number
  /** Trailing stdout+stderr of the hook command. */
  readonly output?: string
  readonly error?: string
}

export type ActFailure = {
  readonly ok: false
  readonly action: string
  readonly error: string
  /** The first premise that found no match, when that is the failure. */
  readonly failedPremise?: string
  /** New `EXPECTS` violations, when the shape gate rejected (spec §25.3). */
  readonly violations?: readonly Violation[]
}

export type ActSuccess = {
  readonly ok: true
  readonly action: string
  readonly subject: string
  readonly dryRun: boolean
  /** Solutions of the premise join — 1 when there are no premises. */
  readonly solutions: number
  readonly effects: readonly EffectOutcome[]
  readonly appended: number
  readonly updated: number
  readonly unchanged: number
  readonly hook?: HookOutcome
}

export type ActReport = ActFailure | ActSuccess

const fail = (action: string, error: string, rest: Partial<ActFailure> = {}): ActFailure =>
  ({ ok: false, action, error, ...rest })

type Solution = {
  readonly bindings: Readonly<Record<string, string>>
  readonly rows: readonly Row.t[]
}

/**
 * Formats one caller argument as the CAVE term text it binds to —
 * exactly the §23.1 record-field rules (spec §25.2), via
 * `@cavelang/connect`.
 */
const formatArg = (name: string, value: unknown): { text?: string, problem?: string } => {
  const formatted = Template.formatValue(value, 'payload')
  switch (formatted.kind) {
    case 'ok':
      return { text: formatted.text }
    case 'missing':
      return { problem: `parameter ${name} requires a value` }
    default:
      return { problem: `parameter ${name}: ${formatted.message}` }
  }
}

type Instantiated = {
  readonly claim: Claim.t
  readonly key: string
  readonly line: string
}

/**
 * Instantiates one effect template under the chosen bindings and pushes
 * it through the ordinary emit → canonicalize pipeline (§13.4), so
 * inverse verbs swap and entities normalize. The claim key is computed
 * on the *stamped* claim — the same claim `insertResult` will key.
 */
const instantiate = (
  effect: Ast.Full,
  bindings: Readonly<Record<string, string>>,
  registry: Canonical.Registry.t,
  subject: string
): { instantiated?: Instantiated, problem?: string } => {
  const term = (candidate: Claim.Term, position: 'subject' | 'payload'): Claim.Term =>
    candidate.kind === 'entity' && candidate.text.startsWith('?') && candidate.text.length > 1 ?
      boundTerm(bindings[candidate.text.slice(1)]!, position) :
      candidate
  let payload: Claim.Payload = effect.payload
  if (payload.kind === 'relation') {
    payload = Claim.relation(term(payload.object, 'payload'))
  } else if (payload.kind === 'attribute' && payload.value.kind === 'atom' && payload.value.raw.startsWith('?')) {
    payload = Claim.attribute(payload.attribute, Row.parseValue(bindings[payload.value.raw.slice(1)]!))
  } else if (payload.kind === 'metric' && payload.value.kind === 'atom' && payload.value.raw.startsWith('?')) {
    payload = Claim.metric(Row.parseValue(bindings[payload.value.raw.slice(1)]!))
  }
  const draft = Claim.of({
    subject: term(effect.subject, 'subject'),
    verb: effect.verb,
    negated: effect.negated,
    payload,
    contexts: effect.meta.contexts,
    tags: effect.meta.tags,
    importance: effect.meta.importance,
    conf: effect.meta.conf ?? 1,
    ...effect.meta.comment === undefined ? {} : { comment: effect.meta.comment }
  })
  const result = Canonical.canonicalizeText(Canonical.emitClaim(draft), registry)
  const claim = result.claims[0]?.claim
  if (result.problems.length > 0 || claim === undefined) {
    const detail = result.problems.map(problem => problem.message).join('; ')
    return { problem: `effect ${JSON.stringify(Canonical.emitClaim(draft))} did not canonicalize${detail === '' ? '' : ` — ${detail}`}` }
  }
  const stamped = Context.hasSource(claim.contexts) ?
    claim :
    { ...claim, contexts: [...claim.contexts, Context.source(subject)] }
  return { instantiated: { claim, key: Key.of(stamped), line: Canonical.emitClaim(claim) } }
}

/** POSIX single-quoting — hook placeholders never splice raw (spec §25.4). */
export const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", `'\\''`)}'`

/**
 * Substitutes `{action}` and `{<param>}` placeholders in one pass —
 * substituted values are never re-scanned, unknown placeholders stay.
 */
export const substitute = (
  template: string,
  action: string,
  args: Readonly<Record<string, unknown>>
): string =>
  template.replace(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g, (whole, name: string) =>
    name === 'action' ? shellQuote(action) :
    name in args ? shellQuote(String(args[name])) :
    whole)

const runHook = (
  name: string,
  template: string,
  action: Action.t,
  args: Readonly<Record<string, unknown>>,
  claims: readonly string[],
  options: ActOptions
): HookOutcome => {
  const command = substitute(template, action.name, args)
  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    input: `${claims.join('\n')}\n`,
    timeout: (options.hookTimeoutSeconds ?? defaultHookTimeoutSeconds) * 1000,
    ...options.cwd === undefined ? {} : { cwd: options.cwd }
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const error =
    result.error !== undefined ? result.error.message :
    result.status !== 0 ? `hook exited with ${result.status ?? `signal ${result.signal}`}` :
    undefined
  return {
    name,
    fired: true,
    code: result.status,
    ...output === '' ? {} : { output },
    ...error === undefined ? {} : { error }
  }
}

const rollback = Symbol('cave-act dry run')

/** Thrown inside the transaction on gate rejection; never escapes `act`. */
const rejected = Symbol('cave-act gate rejected')
type Rejected = Error & { readonly [rejected]: readonly Violation[] }

const isRejected = (error: unknown): error is Rejected =>
  error instanceof Error && rejected in error

/**
 * Executes one action (spec §25.2). See the module doc for semantics;
 * `dryRun` computes the same report inside a rolled-back transaction.
 */
export const act = (
  store: Store,
  name: string,
  args: Readonly<Record<string, unknown>> = {},
  options: ActOptions = {}
): ActReport => {
  const resolved = loadAction(store, name)
  if (resolved === undefined) {
    return fail(name, `no current action ${JSON.stringify(Action.actionSubject(name))} — declare it first (spec §25.1)`)
  }
  if (resolved.loaded === undefined) {
    return fail(name, `the declaration of ${JSON.stringify(Action.actionSubject(name))} does not parse: ${resolved.problems.join('; ')}`)
  }
  const { action, row }: Loaded = resolved.loaded

  // Arguments: every parameter supplied, no unknown names (§25.2).
  const unknown = Object.keys(args).filter(key => !action.params.includes(key))
  if (unknown.length > 0) {
    return fail(action.name, `unknown parameter(s) ${unknown.join(', ')} — ${action.name} takes ${action.params.length === 0 ? 'none' : action.params.map(param => `?${param}`).join(', ')}`)
  }
  const bindings: Record<string, string> = {}
  for (const param of action.params) {
    const { text, problem } = formatArg(param, args[param])
    if (problem !== undefined) {
      return fail(action.name, problem)
    }
    bindings[param] = text!
  }

  // Premises: the §24.2 join with parameters pre-bound (§25.2).
  let solutions: Solution[] = [{ bindings, rows: [] }]
  for (const premise of action.premises) {
    if (premise.kind === 'constraint') {
      solutions = solutions.filter(solution =>
        satisfies(solution.bindings[premise.variable], premise.op, premise.value))
    } else {
      solutions = solutions.flatMap(solution => {
        const pattern = specialize(premise.pattern, solution.bindings)
        if (pattern === undefined) {
          return []
        }
        return match(store, pattern, { aliases: options.aliases === true }).map(found => ({
          bindings: { ...solution.bindings, ...found.bindings },
          rows: found.row === undefined ? solution.rows : [...solution.rows, found.row]
        }))
      })
    }
    if (solutions.length === 0) {
      return fail(action.name, `precondition failed — no current belief satisfies ${JSON.stringify(premise.text)}`,
        { failedPremise: premise.text })
    }
  }

  // Premise-bound effect variables must bind uniquely (§25.2).
  const chosen: Record<string, string> = { ...bindings }
  for (const variable of new Set(action.effects.flatMap(Action.effectVariables))) {
    if (chosen[variable] !== undefined) {
      continue
    }
    const values = [...new Set(solutions.map(solution => solution.bindings[variable]!))]
    if (values.length > 1) {
      return fail(action.name,
        `ambiguous binding for ?${variable} (${values.join(', ')}) — an action executes once, deterministically (spec §25.2)`)
    }
    chosen[variable] = values[0]!
  }

  // Instantiation is a pure read — any problem fails before writing.
  const instantiated: Instantiated[] = []
  for (const effect of action.effects) {
    const { instantiated: entry, problem } = instantiate(effect, chosen, store.registry(), action.subject)
    if (problem !== undefined) {
      return fail(action.name, problem)
    }
    instantiated.push(entry!)
  }

  const check = options.check !== false
  const before = check ? new Set(evaluate(store).violations.map(violationKey)) : undefined
  const effects: EffectOutcome[] = []
  const changed: string[] = []
  let appended = 0
  let updated = 0
  let unchanged = 0
  const premiseIds = [...new Set(solutions[0]!.rows.map(premiseRow => premiseRow.id))]

  try {
    store.transaction(() => {
      for (const entry of instantiated) {
        const current = store.currentBelief(entry.key)
        const columns = Row.toColumns(entry.claim)
        if (current !== undefined && Math.abs(current.conf - entry.claim.conf) < 1e-9 &&
            current.value_text === columns.valueText) {
          effects.push({ line: entry.line, outcome: 'unchanged' })
          unchanged += 1
          continue
        }
        const inserted = store.insertResult(
          { claims: [{ claim: entry.claim, line: 0 }], edges: [], registry: store.registry(), problems: [] },
          { source: action.subject }
        )
        const id = inserted.ids[0]!
        store.appendEdges([
          ...premiseIds.map(childId => ({ parentId: id, role: 'BECAUSE' as const, childId })),
          { parentId: id, role: 'VIA' as const, childId: row.id }
        ])
        if (current === undefined || current.conf === 0) {
          effects.push({ line: entry.line, outcome: 'appended' })
          appended += 1
        } else {
          effects.push({ line: entry.line, outcome: 'updated' })
          updated += 1
        }
        changed.push(entry.line)
      }
      if (before !== undefined) {
        const fresh = evaluate(store).violations.filter(violation => !before.has(violationKey(violation)))
        if (fresh.length > 0) {
          throw Object.assign(new Error(`shape gate: ${fresh.length} new violation(s)`), { [rejected]: fresh })
        }
      }
      if (options.dryRun === true) {
        throw rollback
      }
    })
  } catch (error) {
    if (isRejected(error)) {
      return fail(action.name, `rejected by the shape gate — ${error[rejected].length} new violation(s), nothing appended (spec §25.3)`,
        { violations: error[rejected] })
    }
    if (error !== rollback) {
      throw error
    }
  }

  // The hook runs strictly after commit (§25.4) — dry runs and no-op
  // executions never reach the outside world.
  const hookName = currentHook(store, action.subject)
  let hook: undefined | HookOutcome
  if (hookName !== undefined) {
    const template = options.hooks?.[hookName]
    if (options.dryRun === true) {
      hook = { name: hookName, fired: false, note: 'dry run' }
    } else if (changed.length === 0) {
      hook = { name: hookName, fired: false, note: 'nothing changed' }
    } else if (template === undefined) {
      hook = { name: hookName, fired: false, note: 'not configured' }
    } else {
      hook = runHook(hookName, template, action, args, changed, options)
    }
  }

  return {
    ok: true,
    action: action.name,
    subject: action.subject,
    dryRun: options.dryRun === true,
    solutions: solutions.length,
    effects,
    appended,
    updated,
    unchanged,
    ...hook === undefined ? {} : { hook }
  }
}
