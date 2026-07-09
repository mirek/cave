/**
 * The forward-chaining derivation engine (spec §24.2–§24.5).
 *
 * Rules live in the store as ordinary claims (§24.1's declaration shape),
 * so derived claims can point lineage edges at them:
 *
 * ```cave
 * rule/9f30ac9be4dd HAS rule: `?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z` @src:cave-derive
 * ```
 *
 * `derive` fires every current positive rule over current beliefs and
 * appends what follows:
 *
 * - premises join left-to-right, each partial binding specializing the
 *   next pattern and running it through the ordinary CAVE-Q compiler —
 *   inverse verbs, transitive hops and the alias closure come for free;
 * - conclusion confidence is noisy-AND (`@cavelang/fusion`, the
 *   independence assumption explicit): rule conf × Π premise-row confs;
 *   several derivations of one conclusion keep the strongest (§24.2);
 * - derived rows are stamped `@src:rule/<digest>` (§9.5) and linked
 *   `BECAUSE` to their specific premise rows and `VIA` to the rule's
 *   declaration row (§24.3);
 * - re-runs are idempotent — a conclusion equal to current belief appends
 *   nothing — and incremental by per-rule tx watermark claims: a rule
 *   re-fires only when rows recorded since its watermark could extend a
 *   premise match (§24.4);
 * - support is recomputed on every firing: previously-derived claims the
 *   rule no longer concludes are retracted `@ 0%`, and while a fired
 *   rule's earlier derivations are being re-established they are invisible
 *   to premise matching unless re-supported — so retracting a premise
 *   retracts the whole dependent chain, mutually-supporting cycles
 *   included (§24.5).
 */

import { Claim, Confidence, Context, Key, Value, Verb } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { noisyAndIndependent } from '@cavelang/fusion'
import { Row, type Store } from '@cavelang/store'
import { match, type Pattern } from '@cavelang/query'
import * as Rule from './rule.ts'

/** Attribute of rule declaration claims: `rule/<digest> HAS rule: …`. */
export const ruleAttribute = 'rule'

/** Attribute of per-rule watermark claims (§24.4). */
export const watermarkAttribute = 'derive-watermark'

/** Source context stamped on declarations and bookkeeping (like `src:cave-connect`). */
export const provenanceContext = 'src:cave-derive'

/** Declaration subject of a rule: its digest under the `rule/` scope. */
export const ruleSubject = (digest: string): string =>
  `rule/${digest}`

export type DeriveOptions = {
  /** Ignore stored watermarks — re-fire every rule (§24.4). */
  readonly full?: boolean
  /** Run everything inside a rolled-back transaction; report only. */
  readonly dryRun?: boolean
  /** Premises match through the alias closure (spec §13.6). */
  readonly aliases?: boolean
  /** Conclusions below this confidence are not asserted (default 0.05). */
  readonly minConf?: number
  /** Fixpoint guard — maximum evaluation passes (default 20). */
  readonly maxPasses?: number
}

export const defaultMinConf = 0.05

export const defaultMaxPasses = 20

export type RuleOutcome = {
  /** Declaration subject, conventionally `rule/<digest>`. */
  readonly subject: string
  readonly digest: string
  readonly text: string
  readonly label?: string
  /** `false` when every pass skipped the rule — watermark said nothing new. */
  fired: boolean
  evaluations: number
  /** Solutions of the rule's final evaluation. */
  solutions: number
  /** Conclusions asserted for the first time (or re-asserted after retraction). */
  appended: number
  /** Conclusions whose confidence or value changed — belief updates. */
  updated: number
  /** Idempotent skips — conclusion equals current belief (§24.4). */
  unchanged: number
  /** Previously-derived claims retracted — premises no longer hold (§24.5). */
  retracted: number
  readonly problems: string[]
}

export type RuleProblem = {
  readonly subject: string
  readonly problems: readonly string[]
}

export type DeriveReport = {
  readonly rules: readonly RuleOutcome[]
  /** Stored rule declarations that failed to parse — reported, skipped. */
  readonly problems: readonly RuleProblem[]
  readonly passes: number
  readonly appended: number
  readonly updated: number
  readonly unchanged: number
  readonly retracted: number
  readonly notes: readonly string[]
}

const safeAtomRe = /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/

/** In-band declaration rows are never retracted — verb lifecycle is open. */
const isDeclaration = (row: Row.t): boolean =>
  row.verb === 'REVERSE' || (row.verb === 'IS' && row.object === 'verb')

/** Claim key of a `subject HAS <attribute>: … @src:cave-derive` bookkeeping claim. */
const bookkeepingKey = (subject: string, attribute: string): string =>
  Key.of(Claim.of({
    subject: Claim.entity(subject),
    verb: 'HAS',
    payload: Claim.attribute(attribute, Value.parse('x')),
    contexts: [provenanceContext]
  }))

const maxTx = (store: Store): undefined | string =>
  (store.db.prepare('SELECT MAX(tx) AS t FROM cave_claim').get() as { t: null | string }).t ?? undefined

/** Latest row per claim key among `rows` — the series current beliefs. */
const latestPerKey = (rows: readonly Row.t[]): Map<string, Row.t> => {
  const latest = new Map<string, Row.t>()
  for (const row of rows) {
    const seen = latest.get(row.claim_key)
    if (seen === undefined || seen.tx < row.tx) {
      latest.set(row.claim_key, row)
    }
  }
  return latest
}

/** Appends a retraction — the row's claim at `@ 0%`, same claim key (§9.3). */
const retract = (store: Store, row: Row.t, comment: string): void => {
  store.insertResult({
    claims: [{ claim: { ...store.toClaim(row), conf: 0, raw: '', comment }, line: 0 }],
    edges: [],
    registry: store.registry(),
    problems: []
  })
}

type Loaded = {
  readonly rule: Rule.t
  /** The declaration row — target of derived claims' `VIA` edges (§24.3). */
  readonly row: Row.t
  readonly outcome: RuleOutcome
}

/**
 * Loads every current positive rule declaration (attribute `rule`),
 * parses the rule text and dedupes by digest.
 */
const loadRules = (store: Store): { loaded: Loaded[], problems: RuleProblem[], notes: string[] } => {
  const loaded: Loaded[] = []
  const problems: RuleProblem[] = []
  const notes: string[] = []
  const byDigest = new Map<string, string>()
  const declarations = store.currentBeliefs().filter(row =>
    row.verb === 'HAS' && row.attribute === ruleAttribute && row.negated === 0 && row.conf > 0 && row.value_text !== null)
  for (const row of declarations) {
    const text = Row.parseValue(row.value_text!).raw
    const parsed = Rule.parse(text)
    if (!parsed.ok) {
      problems.push({ subject: row.subject, problems: parsed.problems })
      continue
    }
    const seenAs = byDigest.get(parsed.rule.digest)
    if (seenAs !== undefined) {
      notes.push(`${row.subject} duplicates ${seenAs} — one rule, first declaration fires`)
      continue
    }
    byDigest.set(parsed.rule.digest, row.subject)
    const label = parsed.rule.label ?? row.comment ?? undefined
    loaded.push({
      rule: parsed.rule,
      row,
      outcome: {
        subject: row.subject,
        digest: parsed.rule.digest,
        text: parsed.rule.text,
        ...label === undefined ? {} : { label },
        fired: false,
        evaluations: 0,
        solutions: 0,
        appended: 0,
        updated: 0,
        unchanged: 0,
        retracted: 0,
        problems: []
      }
    })
  }
  return { loaded, problems, notes }
}

/**
 * Could a row recorded after `mark` extend a match of one of the rule's
 * premises? A *shape* test — subject/verb/object/attribute/negated plus
 * context and tag membership; confidence and currency are ignored, so a
 * retraction row re-fires the rules its claim used to feed (§24.5).
 * Over-matching costs a harmless re-evaluation; under-matching would be a
 * correctness bug — under `aliases`, entity terms are dropped from the
 * test (closure membership can widen any name) and any new `ALIAS` row
 * fires too.
 */
const shapeMatchesSince = (store: Store, rule: Rule.t, mark: string, aliases: boolean): boolean => {
  const registry = store.registry()
  for (const premise of rule.premises) {
    if (premise.kind !== 'pattern') {
      continue
    }
    let verb = premise.pattern.verb
    let subjectSlot = premise.pattern.subject
    let objectSlot: undefined | Pattern.Slot =
      premise.pattern.payload.kind === 'object' ? premise.pattern.payload.object : undefined
    if (verb.kind === 'verb') {
      const { primary, isInverse } = Canonical.Registry.primaryOf(registry, verb.name)
      if (isInverse) {
        const swapped = objectSlot ?? { kind: 'wildcard' as const }
        objectSlot = subjectSlot
        subjectSlot = swapped
        verb = { kind: 'verb', name: primary, transitive: verb.transitive }
      }
    }
    const transitive = verb.kind === 'verb' && verb.transitive
    const conditions: string[] = ['c.tx > ?']
    const params: (string | number)[] = [mark]
    if (verb.kind === 'verb') {
      conditions.push('c.verb = ?')
      params.push(verb.name)
    }
    conditions.push(`c.negated = ${!transitive && premise.pattern.negated ? 1 : 0}`)
    if (transitive) {
      // Any new edge of the verb can extend a path — endpoints unbounded.
      conditions.push('c.object IS NOT NULL')
    } else {
      if (subjectSlot.kind === 'term' && !aliases) {
        conditions.push('c.subject = ?')
        params.push(subjectSlot.text)
      }
      if (objectSlot?.kind === 'term' && !aliases) {
        // A date/number object also matches metric rows (value in value_text).
        conditions.push('(c.object = ? OR c.value_text = ?)')
        params.push(objectSlot.text, objectSlot.text)
      }
      if (premise.pattern.payload.kind === 'attribute') {
        conditions.push('c.attribute = ?')
        params.push(premise.pattern.payload.attribute)
        if (premise.pattern.payload.value.kind === 'term') {
          conditions.push('c.value_text = ?')
          params.push(premise.pattern.payload.value.text)
        }
      }
    }
    for (const context of premise.pattern.contexts) {
      conditions.push('EXISTS (SELECT 1 FROM cave_context x WHERE x.claim_id = c.id AND x.context = ?)')
      params.push(context)
    }
    for (const tag of premise.pattern.tags) {
      if (tag.value === undefined) {
        conditions.push('EXISTS (SELECT 1 FROM cave_tag t WHERE t.claim_id = c.id AND t.key = ? AND t.value IS NULL)')
        params.push(tag.key)
      } else {
        conditions.push('EXISTS (SELECT 1 FROM cave_tag t WHERE t.claim_id = c.id AND t.key = ? AND t.value = ?)')
        params.push(tag.key, tag.value)
      }
    }
    const row = store.db.prepare(`SELECT 1 AS hit FROM cave_claim c WHERE ${conditions.join(' AND ')} LIMIT 1`)
      .get(...params)
    if (row !== undefined) {
      return true
    }
  }
  if (aliases) {
    const row = store.db.prepare("SELECT 1 AS hit FROM cave_claim c WHERE c.tx > ? AND c.verb = 'ALIAS' LIMIT 1").get(mark)
    if (row !== undefined) {
      return true
    }
  }
  return false
}

/**
 * Specializes a pattern under partial bindings: bound variables become
 * terms, so each join step runs an ordinary CAVE-Q query. Shared with
 * `@cavelang/act`, whose premise evaluation is the same left-to-right
 * join with parameters pre-bound (spec §25.2).
 * @returns `undefined` when a verb variable is bound to a non-verb —
 * no row can match.
 */
export const specialize = (pattern: Pattern.t, bindings: Readonly<Record<string, string>>): undefined | Pattern.t => {
  const slot = (candidate: Pattern.Slot): Pattern.Slot =>
    candidate.kind === 'var' && bindings[candidate.name] !== undefined ?
      { kind: 'term', text: bindings[candidate.name]! } :
      candidate
  let verb = pattern.verb
  if (verb.kind === 'var' && bindings[verb.name] !== undefined) {
    const name = bindings[verb.name]!
    if (!Verb.isVerbToken(name)) {
      return undefined
    }
    verb = { kind: 'verb', name, transitive: false }
  }
  const payload: Pattern.PayloadPattern =
    pattern.payload.kind === 'object' ? { kind: 'object', object: slot(pattern.payload.object) } :
    pattern.payload.kind === 'attribute' ? { kind: 'attribute', attribute: pattern.payload.attribute, value: slot(pattern.payload.value) } :
    pattern.payload
  return { ...pattern, subject: slot(pattern.subject), verb, payload }
}

/** Evaluates a `?var op value` constraint against the variable's binding. */
export const satisfies = (bound: undefined | string, op: Rule.ConstraintOp, literal: Value.t): boolean => {
  if (bound === undefined) {
    return false
  }
  const value = Row.parseValue(bound)
  if (value.num !== undefined && literal.num !== undefined) {
    // A unit on the constraint demands the same unit on the value; a bare
    // numeric constraint compares numbers regardless of unit.
    if (literal.unit !== undefined && value.unit !== literal.unit) {
      return false
    }
    switch (op) {
      case '=': return value.num === literal.num
      case '!=': return value.num !== literal.num
      case '>': return value.num > literal.num
      case '>=': return value.num >= literal.num
      case '<': return value.num < literal.num
      case '<=': return value.num <= literal.num
    }
  }
  if (op === '=') {
    return value.raw === literal.raw
  }
  if (op === '!=') {
    return value.raw !== literal.raw
  }
  return false
}

/**
 * A bound value substituted into a conclusion term slot. Stored bindings
 * are formatted (`"…"`/`` `…` `` literals keep their delimiters); bare
 * text that would not re-tokenize as one term is wrapped as a text
 * literal — except number/date values in payload position, which the
 * pipeline classifies as metrics.
 */
export const boundTerm = (bound: string, position: 'subject' | 'payload'): Claim.Term => {
  const term = Row.parseTerm(bound)
  if (term.kind !== 'entity') {
    return term
  }
  if (safeAtomRe.test(term.text)) {
    return term
  }
  if (position === 'payload') {
    const value = Value.parse(term.text)
    if (value.kind === 'number' || value.kind === 'date') {
      return term
    }
  }
  return Claim.text(term.text)
}

type Solution = {
  readonly bindings: Readonly<Record<string, string>>
  readonly rows: readonly Row.t[]
}

type Conclusion = {
  readonly key: string
  readonly claim: Claim.t
  readonly conf: number
  readonly rows: readonly Row.t[]
}

/**
 * Instantiates the conclusion template for one solution and pushes it
 * through the ordinary emit → canonicalize pipeline, so inverse verbs
 * swap, entities normalize, and the stored `raw_line` is the canonical
 * text (§24.2). The claim key is computed on the *stamped* claim — the
 * same claim `insertResult` will key.
 */
const conclude = (
  rule: Rule.t,
  solution: Solution,
  registry: Canonical.Registry.t
): { conclusion?: Conclusion, problem?: string } => {
  const template = rule.conclusion
  const term = (candidate: Claim.Term, position: 'subject' | 'payload'): Claim.Term =>
    candidate.kind === 'entity' && candidate.text.startsWith('?') && candidate.text.length > 1 ?
      boundTerm(solution.bindings[candidate.text.slice(1)]!, position) :
      candidate
  let payload: Claim.Payload = template.payload
  if (payload.kind === 'relation') {
    payload = Claim.relation(term(payload.object, 'payload'))
  } else if (payload.kind === 'attribute' && payload.value.kind === 'atom' && payload.value.raw.startsWith('?')) {
    payload = Claim.attribute(payload.attribute, Row.parseValue(solution.bindings[payload.value.raw.slice(1)]!))
  } else if (payload.kind === 'metric' && payload.value.kind === 'atom' && payload.value.raw.startsWith('?')) {
    payload = Claim.metric(Row.parseValue(solution.bindings[payload.value.raw.slice(1)]!))
  }
  const conf = Confidence.parse(Confidence.format(
    noisyAndIndependent(rule.conf, solution.rows.map(row => row.conf))
  ))!
  const draft = Claim.of({
    subject: term(template.subject, 'subject'),
    verb: template.verb,
    negated: template.negated,
    payload,
    contexts: template.meta.contexts,
    tags: template.meta.tags,
    importance: template.meta.importance,
    conf,
    ...template.meta.comment === undefined ? {} : { comment: template.meta.comment }
  })
  const result = Canonical.canonicalizeText(Canonical.emitClaim(draft), registry)
  const claim = result.claims[0]?.claim
  if (result.problems.length > 0 || claim === undefined) {
    const detail = result.problems.map(problem => problem.message).join('; ')
    return { problem: `conclusion ${JSON.stringify(Canonical.emitClaim(draft))} did not canonicalize${detail === '' ? '' : ` — ${detail}`}` }
  }
  const stamped = Context.hasSource(claim.contexts) ?
    claim :
    { ...claim, contexts: [...claim.contexts, Context.source(ruleSubject(rule.digest))] }
  return { conclusion: { key: Key.of(stamped), claim, conf: stamped.conf, rows: solution.rows } }
}

const rollback = Symbol('cave-derive dry run')

/**
 * Fires the store's rules to fixpoint (§24.2). See the module doc for the
 * semantics; `dryRun` computes the same report inside a rolled-back
 * transaction.
 */
export const derive = (store: Store, options: DeriveOptions = {}): DeriveReport => {
  const minConf = options.minConf ?? defaultMinConf
  const maxPasses = options.maxPasses ?? defaultMaxPasses
  const aliases = options.aliases === true
  const { loaded, problems, notes } = loadRules(store)

  let passes = 0
  const supported = new Set<string>()
  /** Suspended rows (§24.5): a fired rule's prior derivations, by row id. */
  const suspended = new Map<string, { row: Row.t, outcome: RuleOutcome }>()
  const fired = new Set<string>()
  /** Per-rule scan mark: rows at or before it are fully accounted for. */
  const marks = new Map<string, undefined | string>()
  const storedMarks = new Map<string, undefined | string>()

  for (const { rule } of loaded) {
    const watermark = store.currentBelief(bookkeepingKey(ruleSubject(rule.digest), watermarkAttribute))
    const stored = watermark !== undefined && watermark.conf > 0 ? watermark.value_text ?? undefined : undefined
    storedMarks.set(rule.digest, stored)
    marks.set(rule.digest, options.full === true ? undefined : stored)
  }

  const suspend = (entry: Loaded): void => {
    const rows = store.byContext(Context.source(ruleSubject(entry.rule.digest)))
    for (const row of latestPerKey(rows).values()) {
      if (row.conf > 0 && !isDeclaration(row)) {
        suspended.set(row.id, { row, outcome: entry.outcome })
      }
    }
  }

  /** Premise matches, minus suspended rows that have not been re-supported. */
  const matchPremise = (pattern: Pattern.t): { bindings: Readonly<Record<string, string>>, row?: Row.t }[] =>
    match(store, pattern, { aliases }).filter(entry =>
      entry.row === undefined || !suspended.has(entry.row.id) || supported.has(entry.row.claim_key))

  const evaluate = (entry: Loaded): boolean => {
    const { rule, row, outcome } = entry
    let progress = false
    let solutions: Solution[] = [{ bindings: {}, rows: [] }]
    for (const premise of rule.premises) {
      if (premise.kind === 'constraint') {
        solutions = solutions.filter(solution => satisfies(solution.bindings[premise.variable], premise.op, premise.value))
      } else {
        solutions = solutions.flatMap(solution => {
          const pattern = specialize(premise.pattern, solution.bindings)
          if (pattern === undefined) {
            return []
          }
          return matchPremise(pattern).map(found => ({
            bindings: { ...solution.bindings, ...found.bindings },
            rows: found.row === undefined ? solution.rows : [...solution.rows, found.row]
          }))
        })
      }
      if (solutions.length === 0) {
        break
      }
    }
    outcome.evaluations += 1
    outcome.solutions = solutions.length

    /** Strongest derivation per conclusion key (§24.2). */
    const best = new Map<string, Conclusion>()
    for (const solution of solutions) {
      const { conclusion, problem } = conclude(rule, solution, store.registry())
      if (problem !== undefined) {
        if (!outcome.problems.includes(problem)) {
          outcome.problems.push(problem)
        }
        continue
      }
      const seen = best.get(conclusion!.key)
      if (seen === undefined || conclusion!.conf > seen.conf) {
        best.set(conclusion!.key, conclusion!)
      }
    }

    for (const conclusion of best.values()) {
      if (conclusion.conf < minConf) {
        continue
      }
      if (!supported.has(conclusion.key)) {
        supported.add(conclusion.key)
        progress = true
      }
      const current = store.currentBelief(conclusion.key)
      const columns = Row.toColumns(conclusion.claim)
      if (current !== undefined && current.conf > 0 &&
          Math.abs(current.conf - conclusion.conf) < 1e-9 && current.value_text === columns.valueText) {
        outcome.unchanged += 1
        continue
      }
      const inserted = store.insertResult(
        { claims: [{ claim: conclusion.claim, line: 0 }], edges: [], registry: store.registry(), problems: [] },
        { source: ruleSubject(rule.digest) }
      )
      const id = inserted.ids[0]!
      const premiseIds = [...new Set(conclusion.rows.map(premiseRow => premiseRow.id))]
      store.appendEdges([
        ...premiseIds.map(childId => ({ parentId: id, role: 'BECAUSE' as const, childId })),
        { parentId: id, role: 'VIA' as const, childId: row.id }
      ])
      if (current === undefined || current.conf === 0) {
        outcome.appended += 1
      } else {
        outcome.updated += 1
      }
      progress = true
    }
    return progress
  }

  const run = (): void => {
    for (;;) {
      // Pass loop: evaluate until no rule writes or extends support.
      let quiescent = false
      while (!quiescent && passes < maxPasses) {
        passes += 1
        let progress = false
        for (const entry of loaded) {
          const mark = marks.get(entry.rule.digest)
          const now = maxTx(store)
          if (mark !== undefined && !shapeMatchesSince(store, entry.rule, mark, aliases)) {
            continue
          }
          if (!fired.has(entry.rule.digest)) {
            fired.add(entry.rule.digest)
            entry.outcome.fired = true
            suspend(entry)
          }
          if (evaluate(entry)) {
            progress = true
          }
          marks.set(entry.rule.digest, now)
        }
        quiescent = !progress
      }
      // Retraction phase (§24.5): suspended rows never re-supported lost
      // their premises. Retraction rows are ordinary appends — the loop
      // re-enters so dependent rules see them and cascade.
      let retracted = false
      for (const [id, { row, outcome }] of suspended) {
        if (supported.has(row.claim_key)) {
          continue
        }
        retract(store, row, 'retracted: premises no longer hold')
        suspended.delete(id)
        outcome.retracted += 1
        retracted = true
      }
      if (!retracted || passes >= maxPasses) {
        if (passes >= maxPasses && (!quiescent || retracted)) {
          notes.push(`stopped at ${maxPasses} passes before reaching a fixpoint — re-run to continue, or raise maxPasses`)
        }
        return
      }
    }
  }

  const finalize = (): void => {
    for (const entry of loaded) {
      if (!fired.has(entry.rule.digest)) {
        continue
      }
      const mark = marks.get(entry.rule.digest)
      if (mark === undefined || mark === storedMarks.get(entry.rule.digest)) {
        continue
      }
      store.ingest(`${ruleSubject(entry.rule.digest)} HAS ${watermarkAttribute}: ${mark} @${provenanceContext}`)
    }
  }

  if (options.dryRun === true) {
    try {
      store.transaction(() => {
        run()
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) {
        throw error
      }
    }
  } else {
    store.transaction(() => {
      run()
      finalize()
    })
  }

  const outcomes = loaded.map(entry => entry.outcome)
  return {
    rules: outcomes,
    problems,
    passes,
    appended: outcomes.reduce((sum, outcome) => sum + outcome.appended, 0),
    updated: outcomes.reduce((sum, outcome) => sum + outcome.updated, 0),
    unchanged: outcomes.reduce((sum, outcome) => sum + outcome.unchanged, 0),
    retracted: outcomes.reduce((sum, outcome) => sum + outcome.retracted, 0),
    notes
  }
}
