/**
 * Canonicalization pipeline (spec §13.4).
 *
 * Turns a parsed document into canonical claims plus qualifier edges:
 *
 * 1. verbs are already uppercase (parser enforces the lexical shape);
 * 2. inverse verbs swap subject/object and substitute the primary (§5.5);
 * 3. continuation lines fill their inherited endpoint from the parent (§8.3);
 * 4. entity whitespace normalizes to `-`, proper-noun casing preserved;
 * 5. `raw` keeps the line exactly as written;
 * 6–10. confidence, `~`, multipliers, tag splitting are handled by the
 *    parser and `@cavelang/core`;
 * 11. claim keys are computed on the canonical form (`Key.of`);
 * 12. contexts/tags ride on each claim for the store's side tables.
 *
 * Qualifier lines become claim nodes joined to their parent by edges
 * (§8.1); `UNLESS x` normalizes to `WHEN` + negated condition (§8.2);
 * grouped full claims link to their parent with the `QUALIFIES` role
 * (§13.2). `REVERSE`, `RENAMED-TO`, and extension-verb declarations update
 * the registry in-band, affecting subsequent lines (§5.4, §5.5, §5.8).
 */

import { Claim, Entity, Value, Verb } from '@cavelang/core'
import { parseDocument, type Ast } from '@cavelang/parser'
import * as Registry from './registry.ts'

/** Edge roles persisted in `cave_edge` (spec §13.2). */
export type EdgeRole = 'WHEN' | 'VIA' | 'BECAUSE' | 'QUALIFIES'

/** A canonical claim with its 1-based source line. */
export type Entry = {
  readonly claim: Claim.t
  readonly line: number
}

/** Edge between claim indices (into `Result.claims`). */
export type Edge = {
  readonly parent: number
  readonly role: EdgeRole
  readonly child: number
}

export type Problem = {
  readonly line: number
  readonly message: string
}

export type Result = {
  readonly claims: readonly Entry[]
  readonly edges: readonly Edge[]
  /** Registry after processing — input registry plus in-band declarations. */
  readonly registry: Registry.t
  readonly problems: readonly Problem[]
}

const roleOf: Record<Verb.Qualifier, EdgeRole> = {
  WHEN: 'WHEN',
  UNLESS: 'WHEN',
  VIA: 'VIA',
  BECAUSE: 'BECAUSE'
}

/** Every qualifier operator maps to a parseable canonical verb. */
const comparisonVerbs: Readonly<Record<Ast.ComparisonOp, string>> = {
  '>': 'EXCEEDS',
  '<': 'IS-BELOW',
  '>=': 'IS-AT-LEAST',
  '<=': 'IS-AT-MOST',
  '=': 'EQUALS',
  '!=': 'DIFFERS-FROM'
}

const normalizeTerm = (term: Claim.Term): Claim.Term =>
  term.kind === 'entity' ? Claim.entity(Entity.normalize(term.text)) : term

/**
 * Term ↔ payload conversion for the §5.5 inverse swap. The parser
 * classifies a date/number endpoint as a metric payload but a subject is
 * always a term; swapping must re-classify both directions the same way,
 * or `deploy PRECEDES 2026-01-01` and `2026-01-01 FOLLOWS deploy` would
 * key differently — two keys for one fact.
 */
const termOfPayload = (payload: Claim.Payload): undefined | Claim.Term => {
  switch (payload.kind) {
    case 'relation':
      return payload.object
    case 'metric':
      return payload.value.kind === 'code' ? Claim.code(payload.value.raw) :
        payload.value.kind === 'text' ? Claim.text(payload.value.raw) :
        Claim.entity(Entity.normalize(payload.value.raw))
    default:
      return undefined
  }
}

const payloadOfTerm = (term: Claim.Term): Claim.Payload => {
  if (term.kind === 'entity') {
    const value = Value.parse(term.text)
    if (value.kind === 'number' || value.kind === 'date') {
      return Claim.metric(value)
    }
  }
  return Claim.relation(term)
}

const initOf = (meta: Ast.Meta): Partial<Claim.Init> => ({
  contexts: meta.contexts,
  tags: meta.tags,
  importance: meta.importance,
  ...meta.conf !== undefined ? { conf: meta.conf } : {},
  ...meta.delta !== undefined ? { delta: meta.delta } : {},
  ...meta.sigmaLevel !== undefined ? { sigmaLevel: meta.sigmaLevel } : {},
  ...meta.comment !== undefined ? { comment: meta.comment } : {}
})

/** Canonicalizes a parsed document. */
export const canonicalize = (document: Ast.Document, registry: Registry.t = Registry.empty): Result => {
  const claims: Entry[] = []
  const edges: Edge[] = []
  const problems: Problem[] = []
  /** line index → claim index + the subject as (virtually) written, for §8.3 inheritance. */
  const byLine = new Map<number, { index: number, writtenSubject: Claim.Term }>()

  const problem = (line: number, message: string): void => {
    problems.push({ line, message })
  }

  /** Canonicalizes one full claim body — §13.4 steps 2 and 4 plus assembly. */
  const buildClaim = (full: Ast.Full, raw: string, line: number): { claim: Claim.t, writtenSubject: Claim.Term } => {
    const writtenSubject = normalizeTerm(full.subject)
    let subject = writtenSubject
    let verb = Registry.storageOf(registry, full.verb)
    let payload: Claim.Payload = full.payload
    if (payload.kind === 'relation') {
      payload = Claim.relation(normalizeTerm(payload.object))
    }
    const { primary, isInverse } = Registry.primaryOf(registry, verb)
    if (isInverse) {
      const objectTerm = termOfPayload(payload)
      if (objectTerm === undefined) {
        problem(line, `inverse verb ${verb} needs an object to swap with — keeping the line as written (spec §5.5)`)
      } else {
        payload = payloadOfTerm(subject)
        subject = objectTerm
        verb = primary
      }
    }
    const claim = Claim.of({
      subject,
      verb,
      negated: full.negated,
      payload,
      raw,
      ...initOf(full.meta)
    })
    return { claim, writtenSubject }
  }

  const append = (claim: Claim.t, line: number, writtenSubject: Claim.Term, lineIndex: number): number => {
    const index = claims.length
    claims.push({ claim, line })
    byLine.set(lineIndex, { index, writtenSubject })
    return index
  }

  /** In-band declarations take effect for subsequent lines (spec §5.4, §5.5). */
  const applyDeclarations = (claim: Claim.t, line: number): void => {
    if (claim.payload.kind !== 'relation' || claim.negated) {
      return
    }
    const object = claim.payload.object
    if (claim.verb === Verb.REVERSE && claim.subject.kind === 'entity' && object.kind === 'entity') {
      const declared = Registry.declareReverse(registry, claim.subject.text, object.text)
      registry = declared.registry
      if (!declared.ok) {
        problem(line, declared.problem)
      }
      return
    }
    if (claim.verb === Verb.RENAMED_TO && claim.subject.kind === 'entity' && object.kind === 'entity') {
      const declared = Registry.declareRename(registry, claim.subject.text, object.text)
      registry = declared.registry
      if (!declared.ok) {
        problem(line, declared.problem)
      }
      return
    }
    if (claim.verb === 'IS' && object.kind === 'entity' && object.text === 'verb' &&
        claim.subject.kind === 'entity' && Verb.isVerbToken(claim.subject.text)) {
      registry = Registry.declareVerb(registry, claim.subject.text)
    }
  }

  /** Builds the condition claim of a qualifier line (spec §8.2). */
  const conditionOf = (payload: Ast.QualifierPayload, unless: boolean): Ast.Full => {
    switch (payload.kind) {
      case 'claim':
        return {
          ...payload.claim,
          negated: payload.claim.negated !== (payload.negated !== unless)
        }
      case 'entity':
        return {
          subject: payload.term,
          verb: 'EXISTS',
          negated: payload.negated !== unless,
          payload: Claim.none,
          meta: payload.meta
        }
      case 'comparison':
        return {
          subject: payload.left,
          verb: comparisonVerbs[payload.op],
          negated: payload.negated !== unless,
          payload: Claim.metric(payload.value),
          meta: payload.meta
        }
    }
  }

  document.lines.forEach((line, lineIndex) => {
    switch (line.kind) {
      case 'claim': {
        const { claim, writtenSubject } = buildClaim(line.claim, line.raw, line.line)
        const index = append(claim, line.line, writtenSubject, lineIndex)
        if (line.parent !== undefined) {
          const parent = byLine.get(line.parent)
          if (parent !== undefined) {
            edges.push({ parent: parent.index, role: 'QUALIFIES', child: index })
          }
        }
        applyDeclarations(claim, line.line)
        return
      }
      case 'continuation': {
        const parent = byLine.get(line.parent!)
        if (parent === undefined) {
          problem(line.line, 'continuation has no canonicalized parent')
          return
        }
        const full: Ast.Full = { subject: parent.writtenSubject, ...line.body }
        const { claim, writtenSubject } = buildClaim(full, line.raw, line.line)
        append(claim, line.line, writtenSubject, lineIndex)
        // §8.3: each continuation is an ordinary independent claim, so an
        // in-band declaration works here exactly as on a full line (§5.4).
        applyDeclarations(claim, line.line)
        return
      }
      case 'qualifier': {
        const parent = byLine.get(line.parent!)
        if (parent === undefined) {
          problem(line.line, 'qualifier has no canonicalized parent')
          return
        }
        const full = conditionOf(line.payload, line.qualifier === 'UNLESS')
        const { claim, writtenSubject } = buildClaim(full, line.raw, line.line)
        const index = append(claim, line.line, writtenSubject, lineIndex)
        edges.push({ parent: parent.index, role: roleOf[line.qualifier], child: index })
        return
      }
      default:
        return
    }
  })

  return { claims, edges, registry, problems }
}

/**
 * Parses and canonicalizes CAVE text in one step. Parser diagnostics merge
 * into `problems`.
 */
export const canonicalizeText = (input: string, registry: Registry.t = Registry.empty): Result => {
  const document = parseDocument(input)
  const result = canonicalize(document, registry)
  if (document.diagnostics.length === 0) {
    return result
  }
  return {
    ...result,
    problems: [
      ...document.diagnostics.map(diagnostic => ({ line: diagnostic.line, message: diagnostic.message })),
      ...result.problems
    ]
  }
}
