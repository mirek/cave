/**
 * CAVE-Q patterns (spec §12.1).
 *
 * ```cave
 * ?x USES jwt                       ; all systems using jwt
 * ?x HAS bug: ?bug #security        ; all security bugs
 * ?cause CAUSE app/crash            ; candidate causes
 *   WHERE conf >= 0.7
 * ?x ?verb ?y @production           ; all production facts
 * terrier EXTENDS+ animal           ; transitive hops
 * _ USES jwt                        ; wildcard
 * ```
 *
 * A query is one pattern line followed by any number of `WHERE` filter
 * lines (spec §12.2), indented or not.
 */

import { Confidence, Value, Verb } from '@cavelang/core'
import { Token } from '@cavelang/parser'

/** A pattern slot: named variable, wildcard `_`, or a bound term. */
export type Slot =
  | { readonly kind: 'var', readonly name: string }
  | { readonly kind: 'wildcard' }
  | { readonly kind: 'term', readonly text: string }

/** Verb position: concrete verb (possibly transitive `VERB+`), variable, or wildcard. */
export type VerbSlot =
  | { readonly kind: 'verb', readonly name: string, readonly transitive: boolean }
  | { readonly kind: 'var', readonly name: string }
  | { readonly kind: 'wildcard' }

export type PayloadPattern =
  | { readonly kind: 'object', readonly object: Slot }
  | { readonly kind: 'attribute', readonly attribute: string, readonly value: Slot }
  | { readonly kind: 'any' }

export type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<='

export type Filter =
  | { readonly field: 'conf', readonly op: FilterOp, readonly value: number }
  | { readonly field: 'tag', readonly op: '=', readonly key: string, readonly value?: string }
  | { readonly field: 'context', readonly op: '=', readonly value: string }
  | { readonly field: 'value', readonly op: FilterOp, readonly value: number, readonly unit?: string }
  | { readonly field: 'tx', readonly op: FilterOp, readonly value: string }

export type Pattern = {
  readonly subject: Slot
  readonly verb: VerbSlot
  readonly payload: PayloadPattern
  readonly negated: boolean
  /** `@ctx` filters on the pattern line. */
  readonly contexts: readonly string[]
  /** `#tag[:value]` filters on the pattern line. */
  readonly tags: readonly { key: string, value?: string }[]
  readonly filters: readonly Filter[]
}

export type t = Pattern

const filterOps: readonly FilterOp[] = ['>=', '<=', '!=', '=', '>', '<']

const isFilterOp = (text: string): text is FilterOp =>
  filterOps.includes(text as FilterOp)

const slotOf = (token: Token.t): Slot => {
  if (token.kind === 'word') {
    if (token.text === '_') {
      return { kind: 'wildcard' }
    }
    if (token.text.startsWith('?')) {
      return { kind: 'var', name: token.text.slice(1) }
    }
    return { kind: 'term', text: token.text }
  }
  const delimiter = token.kind === 'code' ? '`' : '"'
  return { kind: 'term', text: `${delimiter}${token.text}${delimiter}` }
}

const verbSlotOf = (token: Token.t): undefined | VerbSlot => {
  if (token.kind !== 'word') {
    return undefined
  }
  if (token.text === '_') {
    return { kind: 'wildcard' }
  }
  if (token.text.startsWith('?')) {
    return { kind: 'var', name: token.text.slice(1) }
  }
  const transitive = token.text.endsWith('+')
  const name = transitive ? token.text.slice(0, -1) : token.text
  return Verb.isVerbToken(name) ? { kind: 'verb', name, transitive } : undefined
}

const parseFilter = (tokens: readonly Token.t[], lineNo: number): Filter => {
  const [field, op, ...valueTokens] = tokens
  const bad = (message: string): never => {
    throw new Error(`CAVE-Q line ${lineNo}: ${message}`)
  }
  if (field?.kind !== 'word' || op?.kind !== 'word' || valueTokens.length === 0) {
    return bad('expected "WHERE <field> <op> <value>" (spec §12.2)')
  }
  if (!isFilterOp(op.text)) {
    return bad(`unknown operator ${JSON.stringify(op.text)}`)
  }
  const valueText = valueTokens.map(token => token.text).join(' ')
  switch (field.text) {
    case 'conf': {
      const conf = valueText.endsWith('%') ? Confidence.parse(valueText) : Number(valueText)
      if (conf === undefined || Number.isNaN(conf)) {
        return bad(`cannot parse confidence ${JSON.stringify(valueText)}`)
      }
      return { field: 'conf', op: op.text, value: conf }
    }
    case 'tag': {
      if (op.text !== '=') {
        return bad('tag filters support = only')
      }
      const colonAt = valueText.indexOf(':')
      return colonAt === -1 ?
        { field: 'tag', op: '=', key: valueText } :
        { field: 'tag', op: '=', key: valueText.slice(0, colonAt), value: valueText.slice(colonAt + 1) }
    }
    case 'context': {
      if (op.text !== '=') {
        return bad('context filters support = only')
      }
      return { field: 'context', op: '=', value: valueText }
    }
    case 'value': {
      const value = Value.parse(valueText)
      if (value.kind !== 'number' || value.num === undefined) {
        return bad(`cannot parse value filter ${JSON.stringify(valueText)}`)
      }
      return {
        field: 'value', op: op.text, value: value.num,
        ...value.unit === undefined ? {} : { unit: value.unit }
      }
    }
    case 'tx':
      return { field: 'tx', op: op.text, value: valueText }
    default:
      return bad(`unknown filter field ${JSON.stringify(field.text)}`)
  }
}

/** Parses a CAVE-Q query: one pattern line plus `WHERE` filter lines. */
export const parse = (input: string): Pattern => {
  const lines = input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith(';'))
  if (lines.length === 0) {
    throw new Error('CAVE-Q: empty query')
  }
  const [patternLine, ...filterLines] = lines
  const { head } = Token.splitComment(patternLine!)
  const tokens = Token.tokenize(head)
  if (tokens.length < 2) {
    throw new Error('CAVE-Q: a pattern needs at least a subject and a verb (spec §12.1)')
  }
  const subject = slotOf(tokens[0]!)
  const verb = verbSlotOf(tokens[1]!)
  if (verb === undefined) {
    throw new Error(`CAVE-Q: cannot parse verb position ${JSON.stringify(tokens[1]!.text)}`)
  }
  let rest = tokens.slice(2)
  const negated = rest[0]?.kind === 'word' && rest[0].text === 'NOT'
  if (negated) {
    rest = rest.slice(1)
  }
  const contexts: string[] = []
  const tags: { key: string, value?: string }[] = []
  const payloadTokens: Token.t[] = []
  for (const token of rest) {
    if (token.kind === 'word' && token.text.startsWith('@') && token.text.length > 1) {
      contexts.push(token.text.slice(1))
    } else if (token.kind === 'word' && token.text.startsWith('#') && token.text.length > 1) {
      const body = token.text.slice(1)
      const colonAt = body.indexOf(':')
      tags.push(colonAt === -1 ? { key: body } : { key: body.slice(0, colonAt), value: body.slice(colonAt + 1) })
    } else {
      payloadTokens.push(token)
    }
  }
  let payload: PayloadPattern
  if (payloadTokens.length === 0) {
    payload = { kind: 'any' }
  } else if (payloadTokens[0]!.kind === 'word' && payloadTokens[0]!.text.endsWith(':') && payloadTokens[0]!.text.length > 1) {
    const valueTokens = payloadTokens.slice(1)
    if (valueTokens.length === 0) {
      throw new Error('CAVE-Q: attribute patterns need a value slot (spec §12.1)')
    }
    if (valueTokens.length === 1) {
      payload = {
        kind: 'attribute',
        attribute: payloadTokens[0]!.text.slice(0, -1),
        value: slotOf(valueTokens[0]!)
      }
    } else {
      const valueText = valueTokens.map(token => token.text).join(' ')
      const value = Value.parse(valueText)
      if (value.kind !== 'number') {
        throw new Error('CAVE-Q: attribute patterns take one value slot or a numeric value (spec §12.1)')
      }
      payload = {
        kind: 'attribute',
        attribute: payloadTokens[0]!.text.slice(0, -1),
        value: { kind: 'term', text: valueText }
      }
    }
  } else if (payloadTokens.length === 1) {
    payload = { kind: 'object', object: slotOf(payloadTokens[0]!) }
  } else {
    throw new Error(`CAVE-Q: cannot parse payload ${JSON.stringify(payloadTokens.map(token => token.text).join(' '))}`)
  }
  const filters = filterLines.map((line, at) => {
    const filterTokens = Token.tokenize(Token.splitComment(line).head)
    const [keyword, ...rest_] = filterTokens
    if (keyword?.kind !== 'word' || keyword.text !== 'WHERE') {
      throw new Error(`CAVE-Q line ${at + 2}: expected WHERE, got ${JSON.stringify(keyword?.text ?? '')}`)
    }
    return parseFilter(rest_, at + 2)
  })
  return { subject, verb, payload, negated, contexts, tags, filters }
}
