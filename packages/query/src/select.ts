/**
 * Conjunctive CAVE-Q queries (spec §12.4): several premises joined left to
 * right, `OPTIONAL` groups, projection and ordering.
 *
 * ```cave
 * ?svc USES jwt, ?svc HAS owner: ?who
 * OPTIONAL ?who HAS team: ?team
 * SELECT DISTINCT ?svc ?team
 * ORDER BY ?team DESC, ?svc
 * ```
 *
 * Premises are the spec §24.1 rule premises verbatim — CAVE-Q patterns and
 * `?var op value` constraints — so a conjunctive query is a rule body
 * without a conclusion. Each line is a clause: a premise line (commas or
 * further lines conjoin), `OPTIONAL` (a left-outer group), `WHERE` (filters
 * the single pattern on the preceding line), `SELECT [DISTINCT]`, and
 * `ORDER BY`. A query that parses as one §12.1 pattern plus `WHERE` lines
 * keeps that meaning exactly; only other text takes this path.
 */

import { Value, Verb } from '@cavelang/core'
import { Token } from '@cavelang/parser'
import { Row } from '@cavelang/store/adapter'
import type { Store } from '@cavelang/store/adapter'
import * as Compile from './compile.ts'
import * as Pattern from './pattern.ts'
import { executeCaptured, storeAtBoundary, validateWindow } from './bounded.ts'
import { captureOptions } from './capture.ts'
import { readSnapshot } from './read-snapshot.ts'
import { assertQueryUnicode } from './unicode.ts'

export type ConstraintOp = '=' | '!=' | '>' | '>=' | '<' | '<='

const constraintOps: readonly ConstraintOp[] = ['>=', '<=', '!=', '=', '>', '<']

export type Premise =
  | { readonly kind: 'pattern', readonly pattern: Pattern.t }
  | { readonly kind: 'constraint', readonly variable: string, readonly op: ConstraintOp, readonly value: Value.t }

/** A required premise, or an `OPTIONAL` group joined as a left-outer join. */
export type Step =
  | { readonly kind: 'required', readonly premise: Premise }
  | { readonly kind: 'optional', readonly premises: readonly Premise[] }

export type Order = { readonly variable: string, readonly descending: boolean }

export type Select = {
  readonly steps: readonly Step[]
  /** Projected variables in `SELECT` order; absent means every bound variable. */
  readonly projection?: readonly string[]
  readonly distinct: boolean
  readonly order: readonly Order[]
}

export type t = Select

/** A parsed query: one §12.1 pattern, or a conjunctive §12.4 query. */
export type Query =
  | { readonly kind: 'pattern', readonly pattern: Pattern.t }
  | { readonly kind: 'select', readonly select: Select }

const isVariableToken = (text: string): boolean =>
  text.startsWith('?') && text.length > 1

/** Variables a pattern binds — the names its slots introduce. */
export const patternVariables = (pattern: Pattern.t): string[] => {
  const names: string[] = []
  if (pattern.subject.kind === 'var') {
    names.push(pattern.subject.name)
  }
  if (pattern.verb.kind === 'var') {
    names.push(pattern.verb.name)
  }
  if (pattern.payload.kind === 'object' && pattern.payload.object.kind === 'var') {
    names.push(pattern.payload.object.name)
  }
  if (pattern.payload.kind === 'attribute' && pattern.payload.value.kind === 'var') {
    names.push(pattern.payload.value.name)
  }
  return names
}

/**
 * Parses one premise segment against the variables bound so far — a
 * constraint (`?var op value`) or a CAVE-Q pattern. Shared with
 * `@cavelang/rules` and `@cavelang/act`, whose premises are the same
 * grammar (spec §24.1, §25.1).
 */
export const parsePremise = (segment: string, bound: ReadonlySet<string>): { premise?: Premise, problem?: string } => {
  const tokens = Token.tokenize(segment)
  if (tokens.length === 0) {
    return { problem: 'empty premise — remove the extra comma' }
  }
  const [first, second, ...rest] = tokens
  // A constraint is `?var op value` — no CAVE-Q pattern puts an operator
  // symbol in verb position, so the shapes never collide.
  if (
    first?.kind === 'word' && isVariableToken(first.text) &&
    second?.kind === 'word' && constraintOps.includes(second.text as ConstraintOp)
  ) {
    const text = tokens.map(token => token.text).join(' ')
    if (rest.length === 0) {
      return { problem: `constraint ${JSON.stringify(text)} is missing a value` }
    }
    const variable = first.text.slice(1)
    if (!bound.has(variable)) {
      return { problem: `constraint on ?${variable} before any pattern premise binds it — reorder the premises` }
    }
    const value = Value.parse(rest.map(token => token.text).join(' '))
    return { premise: { kind: 'constraint', variable, op: second.text as ConstraintOp, value } }
  }
  try {
    return { premise: { kind: 'pattern', pattern: Pattern.parse(segment) } }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Specializes a pattern under partial bindings: bound variables become
 * terms, so each join step runs an ordinary CAVE-Q query. Shared with the
 * rules engine and `@cavelang/act` (spec §24.2, §25.2).
 * @returns `undefined` when a verb variable is bound to a non-verb —
 * no row can match.
 */
export const specialize = (pattern: Pattern.t, bindings: Readonly<Record<string, string>>): undefined | Pattern.t => {
  const slot = (candidate: Pattern.Slot): Pattern.Slot =>
    candidate.kind === 'var' && Object.hasOwn(bindings, candidate.name) && bindings[candidate.name] !== undefined ?
      { kind: 'term', text: bindings[candidate.name]! } :
      candidate
  let verb = pattern.verb
  if (verb.kind === 'var' && Object.hasOwn(bindings, verb.name) && bindings[verb.name] !== undefined) {
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
export const satisfies = (bound: undefined | string, op: ConstraintOp, literal: Value.t): boolean => {
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

/** Top-level comma segments of one line — commas inside literals never split. */
const segmentsOf = (text: string): string[] => {
  const segments: string[] = []
  let cursor = 0
  for (const at of Token.topLevel(text, ',')) {
    segments.push(text.slice(cursor, at))
    cursor = at + 1
  }
  segments.push(text.slice(cursor))
  // A trailing comma continues the conjunction on the next line.
  if (segments.length > 1 && segments.at(-1)!.trim() === '') segments.pop()
  return segments
}

const keywordOf = (tokens: readonly Token.t[]): undefined | 'OPTIONAL' | 'SELECT' | 'ORDER' | 'WHERE' => {
  const [first, second] = tokens
  if (first?.kind !== 'word') return undefined
  if (first.text === 'OPTIONAL' || first.text === 'SELECT' || first.text === 'WHERE') return first.text
  if (first.text === 'ORDER' && second?.kind === 'word' && second.text === 'BY') return 'ORDER'
  return undefined
}

/**
 * Parses a conjunctive query (spec §12.4). Problems throw with the
 * one-based source line, like single-pattern filter diagnostics.
 */
export const parse = (input: string): Select => {
  const lines = input
    .split(/\r?\n/)
    .map((line, index) => {
      assertQueryUnicode(line, index + 1)
      return { text: Token.splitComment(line.trim()).head.trim(), lineNo: index + 1 }
    })
    .filter(line => line.text !== '' && !line.text.startsWith(';'))
  if (lines.length === 0) {
    throw new Error('CAVE-Q: empty query')
  }
  type Group = { kind: 'required' | 'optional', premises: Premise[], patterns: number, line: number }
  const groups: Group[] = []
  const bound = new Set<string>()
  let projection: undefined | string[]
  let distinct = false
  let order: undefined | Order[]
  /** The premise line a following WHERE line filters; reset by other clauses. */
  let whereTarget: undefined | Group
  for (const line of lines) {
    const bad = (message: string): never => {
      throw new Error(`CAVE-Q line ${line.lineNo}: ${message}`)
    }
    const tokens = Token.tokenize(line.text)
    const keyword = keywordOf(tokens)
    switch (keyword) {
      case 'WHERE': {
        // A WHERE line filters the one pattern on the line before it, as it
        // filters the pattern of a single-pattern query (spec §12.2).
        const previous = whereTarget
        if (previous === undefined) {
          return bad('WHERE filters the pattern on the line directly above it (spec §12.4)')
        }
        if (previous.patterns !== 1) {
          return bad('WHERE needs exactly one pattern on the line above — use a ?var constraint or inline @ctx/#tag with several premises (spec §12.4)')
        }
        const at = previous.premises.findIndex(premise => premise.kind === 'pattern')
        const target = previous.premises[at] as { kind: 'pattern', pattern: Pattern.t }
        const filter = Pattern.parseFilter(tokens.slice(1), line.lineNo)
        previous.premises[at] = { kind: 'pattern', pattern: { ...target.pattern, filters: [...target.pattern.filters, filter] } }
        break
      }
      case 'SELECT': {
        whereTarget = undefined
        if (projection !== undefined || distinct) return bad('a query has at most one SELECT line (spec §12.4)')
        let rest = tokens.slice(1)
        if (rest[0]?.kind === 'word' && rest[0].text === 'DISTINCT') {
          distinct = true
          rest = rest.slice(1)
        }
        const names = rest.flatMap(token => token.text.split(',')).filter(text => text !== '')
        if (names.length === 1 && names[0] === '*') break
        if (names.length === 0 && !distinct) return bad('SELECT lists ?variables, or * for all (spec §12.4)')
        if (names.length === 0) break
        projection = names.map(name => isVariableToken(name) ? name.slice(1) :
          bad(`SELECT lists ?variables — got ${JSON.stringify(name)}`))
        if (new Set(projection).size !== projection.length) return bad('SELECT lists a variable twice')
        break
      }
      case 'ORDER': {
        whereTarget = undefined
        if (order !== undefined) return bad('a query has at most one ORDER BY line (spec §12.4)')
        const words = tokens.slice(2).flatMap(token => token.text.split(',')).filter(text => text !== '')
        order = []
        for (const word of words) {
          if (word === 'ASC' || word === 'DESC') {
            const last = order.at(-1)
            if (last === undefined) return bad(`${word} follows the ?variable it orders`)
            order[order.length - 1] = { variable: last.variable, descending: word === 'DESC' }
          } else if (isVariableToken(word)) {
            order.push({ variable: word.slice(1), descending: false })
          } else {
            return bad(`ORDER BY lists ?variables with optional ASC/DESC — got ${JSON.stringify(word)}`)
          }
        }
        if (order.length === 0) return bad('ORDER BY needs at least one ?variable (spec §12.4)')
        break
      }
      default: {
        const optional = keyword === 'OPTIONAL'
        const body = optional ? line.text.slice(line.text.indexOf('OPTIONAL') + 'OPTIONAL'.length) : line.text
        const group: Group = { kind: optional ? 'optional' : 'required', premises: [], patterns: 0, line: line.lineNo }
        for (const segment of segmentsOf(body)) {
          const { premise, problem } = parsePremise(segment, bound)
          if (problem !== undefined) return bad(problem)
          group.premises.push(premise!)
          if (premise!.kind === 'pattern') {
            group.patterns += 1
            patternVariables(premise!.pattern).forEach(name => bound.add(name))
          }
        }
        if (optional && group.patterns === 0) return bad('OPTIONAL needs at least one pattern premise (spec §12.4)')
        groups.push(group)
        whereTarget = group
      }
    }
  }
  if (!groups.some(group => group.kind === 'required' && group.patterns > 0)) {
    throw new Error('CAVE-Q: a query needs at least one required pattern premise (spec §12.4)')
  }
  for (const name of [...projection ?? [], ...(order ?? []).map(entry => entry.variable)]) {
    if (!bound.has(name)) {
      throw new Error(`CAVE-Q: ?${name} is not bound by any premise (spec §12.4)`)
    }
  }
  const steps: Step[] = groups.flatMap((group): Step[] => group.kind === 'optional' ?
    [{ kind: 'optional', premises: group.premises }] :
    group.premises.map(premise => ({ kind: 'required', premise })))
  return {
    steps,
    ...projection === undefined ? {} : { projection },
    distinct,
    order: order ?? []
  }
}

/**
 * Parses any CAVE-Q text. A single §12.1 pattern with `WHERE` lines keeps
 * its original parse; everything else with conjunctive structure — a
 * top-level comma, a second premise line, or a clause keyword — is a
 * §12.4 query. Other unparseable text reports the single-pattern
 * diagnostic, which describes what it most likely meant.
 */
export const parseQuery = (input: string): Query => {
  let singleError: unknown
  try { return { kind: 'pattern', pattern: Pattern.parse(input) } } catch (error) { singleError = error }
  const heads = input.split(/\r?\n/)
    .map(line => Token.splitComment(line.trim()).head.trim())
    .filter(head => head !== '' && !head.startsWith(';'))
  const conjunctive = heads.some(head => Token.topLevel(head, ',').length > 0) ||
    heads.slice(1).some(head => keywordOf(Token.tokenize(head)) !== 'WHERE') ||
    (heads.length > 0 && keywordOf(Token.tokenize(heads[0]!)) !== undefined)
  if (!conjunctive) throw singleError
  return { kind: 'select', select: parse(input) }
}

/**
 * Runs any CAVE-Q text (spec §12.1, §12.4) — the text entry point behind
 * `query()`, `queryRecords()` and `page()`.
 */
export const run = (store: Store, input: string, options: Compile.Options = {}): Compile.Window => {
  options = captureOptions(options)
  const parsed = parseQuery(input)
  return readSnapshot(store, () => parsed.kind === 'pattern' ?
    executeCaptured(store, parsed.pattern, options) :
    execute(store, parsed.select, options))
}

export const query = (store: Store, input: string, options: Compile.Options = {}): Compile.Match[] =>
  run(store, input, options).matches

type Solution = { readonly bindings: Readonly<Record<string, string>>, readonly rows: readonly Row.t[] }

/**
 * Total order over bound values: numbers before text, numbers grouped by
 * unit and compared numerically, text by code point. Unbound (`OPTIONAL`)
 * values sort last in either direction.
 */
const compareValues = (left: undefined | string, right: undefined | string): number => {
  if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1
  const a = Row.parseValue(left)
  const b = Row.parseValue(right)
  const aNum = a.num !== undefined
  const bNum = b.num !== undefined
  if (aNum !== bNum) return aNum ? -1 : 1
  if (aNum && bNum) {
    const aUnit = a.unit ?? ''
    const bUnit = b.unit ?? ''
    if (aUnit !== bUnit) return aUnit < bUnit ? -1 : 1
    if (a.num !== b.num) return a.num! < b.num! ? -1 : 1
  }
  return left < right ? -1 : left > right ? 1 : 0
}

/** Value equality for a deferred join: the same number and unit, or the same text. */
const sameValue = (left: string, right: string): boolean => {
  const a = Row.parseValue(left)
  const b = Row.parseValue(right)
  return a.num !== undefined && b.num !== undefined ?
    a.num === b.num && (a.unit ?? '') === (b.unit ?? '') :
    left === right
}

const lookup = (bindings: Readonly<Record<string, string>>, name: string): undefined | string =>
  Object.hasOwn(bindings, name) ? bindings[name] : undefined

/**
 * Runs a conjunctive query inside the caller's read snapshot. Matches carry
 * `bindings` and `rows` — every premise row the solution stands on, in
 * premise order (transitive premises add their supporting edges under
 * `support`); `row` is absent because a solution has no single claim.
 */
export const execute = (store: Store, select: Select, options: Compile.Options): Compile.Window => {
  const { limit, offset, ...unbounded } = options
  validateWindow(limit, offset)
  const compileStore = storeAtBoundary(store, unbounded)
  // Validate every premise before any join can short-circuit on no rows.
  for (const step of select.steps) {
    const premises = step.kind === 'required' ? [step.premise] : step.premises
    for (const premise of premises) {
      if (premise.kind === 'pattern') Compile.check(compileStore, premise.pattern, unbounded)
    }
  }
  const extend = (solutions: readonly Solution[], premise: Premise): Solution[] => {
    if (premise.kind === 'constraint') {
      return solutions.filter(solution => satisfies(lookup(solution.bindings, premise.variable), premise.op, premise.value))
    }
    // Under `at`, a value-slot binding may be an interpolated trajectory
    // value (spec §32.4) that no stored column holds. Such variables join
    // after valid-time evaluation instead of becoming storage filters.
    const deferred = unbounded.at !== undefined && premise.pattern.payload.kind === 'attribute' &&
      premise.pattern.payload.value.kind === 'var' ? premise.pattern.payload.value.name : undefined
    return solutions.flatMap(solution => {
      const bound = deferred === undefined ? undefined : lookup(solution.bindings, deferred)
      let specializing = solution.bindings
      if (bound !== undefined) {
        const { [deferred!]: _omitted, ...rest } = solution.bindings
        specializing = rest
      }
      const pattern = specialize(premise.pattern, specializing)
      if (pattern === undefined) return []
      const found = executeCaptured(store, pattern, unbounded).matches
      return (bound === undefined ? found : found.filter(match => sameValue(match.bindings[deferred!]!, bound))).map(found => ({
        bindings: { ...solution.bindings, ...found.bindings },
        rows: found.row !== undefined ? [...solution.rows, found.row] :
          found.rows !== undefined ? [...solution.rows, ...found.rows] : solution.rows
      }))
    })
  }
  let solutions: Solution[] = [{ bindings: {}, rows: [] }]
  for (const step of select.steps) {
    if (step.kind === 'required') {
      solutions = extend(solutions, step.premise)
    } else {
      // Left-outer join: a solution the group cannot extend survives as-is,
      // its group variables unbound — unknown, never false (spec §12.4).
      solutions = solutions.flatMap(solution => {
        let extended: Solution[] = [solution]
        for (const premise of step.premises) {
          extended = extend(extended, premise)
          if (extended.length === 0) break
        }
        return extended.length > 0 ? extended : [solution]
      })
    }
    if (solutions.length === 0) break
  }
  if (select.order.length > 0) {
    solutions = solutions
      .map((solution, index) => ({ solution, index }))
      .sort((a, b) => {
        for (const key of select.order) {
          const compared = compareValues(lookup(a.solution.bindings, key.variable), lookup(b.solution.bindings, key.variable))
          if (compared !== 0) {
            const unbound = lookup(a.solution.bindings, key.variable) === undefined ||
              lookup(b.solution.bindings, key.variable) === undefined
            return key.descending && !unbound ? -compared : compared
          }
        }
        return a.index - b.index
      })
      .map(entry => entry.solution)
  }
  const project = (bindings: Readonly<Record<string, string>>): Record<string, string> => {
    if (select.projection === undefined) return { ...bindings }
    const projected: Record<string, string> = {}
    for (const name of select.projection) {
      if (Object.hasOwn(bindings, name)) {
        Object.defineProperty(projected, name, { value: bindings[name], enumerable: true, writable: true, configurable: true })
      }
    }
    return projected
  }
  let matches: { bindings: Record<string, string>, rows: Row.t[] }[] = solutions.map(solution => ({
    bindings: project(solution.bindings), rows: [...solution.rows]
  }))
  if (select.distinct) {
    // One answer per projected binding set; its evidence is the union of
    // the collapsed solutions' rows, first occurrence first.
    const byKey = new Map<string, { bindings: Record<string, string>, rows: Row.t[], seen: Set<string> }>()
    for (const match of matches) {
      const key = JSON.stringify(Object.entries(match.bindings))
      let entry = byKey.get(key)
      if (entry === undefined) {
        entry = { bindings: match.bindings, rows: [], seen: new Set() }
        byKey.set(key, entry)
      }
      for (const row of match.rows) {
        if (!entry.seen.has(row.id)) {
          entry.seen.add(row.id)
          entry.rows.push(row)
        }
      }
    }
    matches = [...byKey.values()].map(entry => ({ bindings: entry.bindings, rows: entry.rows }))
  }
  // As in SQL compilation, an offset only applies together with a limit.
  const start = offset ?? 0
  const windowed = limit === undefined ? matches : matches.slice(start, start + limit)
  return { matches: windowed, scanned: windowed.length }
}
