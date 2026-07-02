/**
 * Document parser (spec §8, §16).
 *
 * Splits input into physical lines, measures indentation, classifies each
 * line (blank / comment / claim / continuation / qualifier), and resolves
 * each indented line's parent — the nearest less-indented structural line
 * above (spec §8).
 *
 * Classification of an indented line follows spec §8's table, decided by
 * what the line starts with:
 *
 * - qualifier verb (`WHEN`/`UNLESS`/`VIA`/`BECAUSE`) → qualifier
 * - bare relational verb → continuation
 * - full triple → grouped claim
 *
 * One ambiguity needs a tiebreak: `API NEEDS auth` starts with a token that
 * is lexically verb-shaped. If the *second* token is also verb-shaped (and
 * not `NOT`), the line is a full triple with an uppercase subject —
 * `CONTAINS REVERSE PART-OF` and `API NEEDS auth` both land here; otherwise
 * it is a continuation.
 *
 * `parseDocument` never throws: broken lines become `invalid` entries and
 * every problem is a diagnostic. `parse` is the strict variant.
 */

import { Verb } from '@cave/core'
import type * as Ast from './ast.ts'
import * as Line from './line.ts'
import * as Token from './token.ts'

const indentOf = (raw: string): { depth: number, rest: string, tabs: boolean } => {
  let depth = 0
  let tabs = false
  while (depth < raw.length && (raw[depth] === ' ' || raw[depth] === '\t')) {
    tabs ||= raw[depth] === '\t'
    depth += 1
  }
  return { depth, rest: raw.slice(depth), tabs }
}

type Classified = 'claim' | 'continuation' | 'qualifier'

const classify = (tokens: readonly Token.t[], depth: number): Classified | { error: string } => {
  const head = tokens[0]!
  if (head.kind === 'word' && Verb.isQualifier(head.text)) {
    return depth > 0 ?
      'qualifier' :
      { error: `qualifier verb ${head.text} at top level — qualifiers attach to a parent claim (spec §8.2)` }
  }
  if (head.kind === 'word' && Verb.isVerbToken(head.text)) {
    const second = tokens[1]
    const secondWord = second?.kind === 'word' ? second.text : undefined
    // Tiebreak between "continuation" and "full triple with an uppercase
    // subject", using the known standard vocabulary (see the README):
    //   CONTAINS REVERSE PART-OF  → claim (declaration)
    //   NEEDS NOT downtime        → continuation (NOT is a modifier)
    //   API NEEDS auth            → claim (second token is a known verb)
    //   USES JWT / PART-OF ORG    → continuation (first known, second not)
    //   API MIGRATES postgres     → claim (neither known — subject wins)
    const kind: Classified =
      secondWord === Verb.REVERSE ? 'claim' :
      secondWord !== undefined && secondWord !== 'NOT' && Verb.isVerbToken(secondWord) ?
        (Verb.isKnown(secondWord) ? 'claim' : Verb.isKnown(head.text) ? 'continuation' : 'claim') :
        'continuation'
    if (kind === 'continuation' && depth === 0) {
      return { error: `continuation line at top level — nothing to inherit a subject from (spec §8.3)` }
    }
    return kind
  }
  return 'claim'
}

type Frame = { index: number, depth: number }

/**
 * Parses a CAVE document. Never throws; problems surface as diagnostics and
 * `invalid` lines.
 */
export const parseDocument = (input: string): Ast.Document => {
  const lines: Ast.Line[] = []
  const diagnostics: Ast.Diagnostic[] = []
  const stack: Frame[] = []
  const rawLines = input.split(/\r?\n/)
  const problem = (line: number, raw: string, message: string): void => {
    diagnostics.push({ line, message, raw })
  }
  rawLines.forEach((raw, at) => {
    const lineNo = at + 1
    const { depth, rest, tabs } = indentOf(raw)
    if (tabs) {
      problem(lineNo, raw, 'tab in indentation — use spaces')
    }
    if (rest === '') {
      lines.push({ kind: 'blank', line: lineNo, raw })
      return
    }
    if (rest.startsWith(';')) {
      lines.push({ kind: 'comment', line: lineNo, raw, text: rest.slice(1).trim() })
      return
    }
    const { head, comment } = Token.splitComment(rest)
    const tokens = Token.tokenize(head)
    if (tokens.length === 0) {
      lines.push({ kind: 'comment', line: lineNo, raw, text: comment ?? '' })
      return
    }
    const kind = classify(tokens, depth)
    if (typeof kind === 'object') {
      problem(lineNo, raw, kind.error)
      lines.push({ kind: 'invalid', line: lineNo, raw, message: kind.error })
      return
    }
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]?.index
    if (parent === undefined && kind !== 'claim') {
      const message = `${kind} line has no parent claim above (spec §8)`
      problem(lineNo, raw, message)
      lines.push({ kind: 'invalid', line: lineNo, raw, message })
      return
    }
    const index = lines.length
    const push = (line: Ast.Line, problems: readonly string[]): void => {
      lines.push(line)
      stack.push({ index, depth })
      for (const message of problems) {
        problem(lineNo, raw, message)
      }
    }
    switch (kind) {
      case 'claim': {
        const result = Line.parseClaim(tokens, comment)
        if (!result.ok) {
          problem(lineNo, raw, result.message)
          lines.push({ kind: 'invalid', line: lineNo, raw, message: result.message })
          return
        }
        push(
          { kind: 'claim', line: lineNo, raw, depth, ...parent !== undefined ? { parent } : {}, claim: result.value },
          result.problems
        )
        return
      }
      case 'continuation': {
        const result = Line.parseBody(tokens, comment)
        if (!result.ok) {
          problem(lineNo, raw, result.message)
          lines.push({ kind: 'invalid', line: lineNo, raw, message: result.message })
          return
        }
        push(
          { kind: 'continuation', line: lineNo, raw, depth, parent: parent!, body: result.value },
          result.problems
        )
        return
      }
      case 'qualifier': {
        const qualifier = (tokens[0] as { text: string }).text as Verb.Qualifier
        const result = Line.parseQualifierPayload(tokens.slice(1), comment)
        if (!result.ok) {
          problem(lineNo, raw, result.message)
          lines.push({ kind: 'invalid', line: lineNo, raw, message: result.message })
          return
        }
        push(
          { kind: 'qualifier', line: lineNo, raw, depth, parent: parent!, qualifier, payload: result.value },
          result.problems
        )
        return
      }
    }
  })
  return { lines, diagnostics }
}

/**
 * Strict parse: like {@link parseDocument} but throws an `Error` listing
 * every diagnostic when the document has any.
 */
export const parse = (input: string): readonly Ast.Line[] => {
  const { lines, diagnostics } = parseDocument(input)
  if (diagnostics.length > 0) {
    const detail = diagnostics
      .map(diagnostic => `  line ${diagnostic.line}: ${diagnostic.message}`)
      .join('\n')
    throw new Error(`CAVE parse failed with ${diagnostics.length} problem(s):\n${detail}`)
  }
  return lines
}
