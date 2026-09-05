/**
 * Document parser (spec §8, §16).
 *
 * Splits input into physical lines, measures indentation, classifies each
 * line (blank / comment / prefix / claim / continuation / qualifier), and
 * resolves each materialized line's parent — the nearest less-indented
 * materialized claim above (spec §8).
 *
 * Classification of an indented line follows spec §8's table, decided by
 * what the line starts with:
 *
 * - qualifier verb (`WHEN`/`UNLESS`/`VIA`/`BECAUSE`) → qualifier
 * - bare relational verb → continuation
 * - full triple → grouped claim
 *
 * An incomplete line with indented content is a shorthand prefix (§8.5).
 * Its tokens are prepended to every child; nested incomplete prefixes
 * compose recursively. Complete lines never become prefixes, preserving the
 * three existing indentation meanings above.
 *
 * A block of full-line `;` comments directly above a line is that line's
 * comment (§6.4): the block's lines and the trailing `; comment` join with
 * newlines, trailing last. Each line keeps everything after `;` and one
 * space, so indented text inside a comment survives. A blank line after the block leaves it
 * documentary — file headers stay out of the store — and a §28.4 `;@ tx`
 * annotation is transparent to the block. A block above a prefix header
 * is documentary like the header's trailing comment; a block above an
 * invalid line is dropped with it.
 *
 * One ambiguity needs a tiebreak: `API NEEDS auth` starts with a token that
 * is lexically verb-shaped. A two-token `VERB VERB` line is a continuation:
 * it has a verb and object but no third token for a full claim's payload.
 * With a payload present, known vocabulary distinguishes grouped claims from
 * continuations — `CONTAINS REVERSE PART-OF` and `API NEEDS auth` are claims.
 *
 * `parseDocument` never throws: broken lines become `invalid` entries and
 * every problem is a diagnostic. `parse` is the strict variant.
 */

import { Verb } from '@cavelang/core'
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
    const third = tokens[2]
    const hasClaimPayload = third !== undefined && !Line.isMetaStart(third)
    // Tiebreak between "continuation" and "full triple with an uppercase
    // subject", using the known standard vocabulary (see the README):
    //   CONTAINS REVERSE PART-OF  → claim (declaration)
    //   NEEDS NOT downtime        → continuation (NOT is a modifier)
    //   API NEEDS auth            → claim (second token is a known verb)
    //   USES JWT / PART-OF ORG    → continuation (first known, second not)
    //   API MIGRATES postgres     → claim (neither known — subject wins)
    const kind: Classified = !hasClaimPayload ? 'continuation' :
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

type Prefix = {
  readonly tokens: readonly Token.t[]
  readonly head: string
  readonly semanticDepth: number
  readonly parent?: number
}

type Frame = {
  readonly index: number
  readonly depth: number
  readonly prefix?: Prefix
}

const hasIndentedContent = (rawLines: readonly string[], at: number, depth: number): boolean => {
  for (let next = at + 1; next < rawLines.length; next += 1) {
    const info = indentOf(rawLines[next]!)
    if (info.rest === '' || info.rest.startsWith(';')) {
      continue
    }
    return info.depth > depth
  }
  return false
}

/**
 * Joins a comment block and a trailing comment into one persisted comment
 * (§6.4), trailing last. Empty lines at either end are dropped, so a block
 * of bare `;` lines is no comment at all; interior empty lines survive as
 * paragraph breaks.
 */
const combineComment = (leading: readonly string[], trailing?: string): undefined | string => {
  const lines = [...leading, ...trailing === undefined ? [] : [trailing]]
  while (lines[0] === '') {
    lines.shift()
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.length === 0 ? undefined : lines.join('\n')
}

type CommentBlock = { readonly texts: string[], readonly raws: string[] }

const emptyBlock = (): CommentBlock => ({ texts: [], raws: [] })

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
  /** The comment block accumulating above the next line (§6.4). */
  let block = emptyBlock()
  const commentLine = (lineNo: number, raw: string, text: string): void => {
    lines.push({ kind: 'comment', line: lineNo, raw, text })
    if (Token.txOfLine(raw) === undefined) {
      block.texts.push(text)
      block.raws.push(raw)
    }
  }
  rawLines.forEach((raw, at) => {
    const lineNo = at + 1
    const { depth, rest, tabs } = indentOf(raw)
    if (tabs) {
      problem(lineNo, raw, 'tab in indentation — use spaces')
    }
    if (rest === '') {
      lines.push({ kind: 'blank', line: lineNo, raw })
      block = emptyBlock()
      return
    }
    if (rest.startsWith(';')) {
      commentLine(lineNo, raw, Token.commentText(rest.slice(1)))
      return
    }
    const split = Token.splitComment(rest)
    const ownHead = split.head.trim()
    const ownTokens = Token.tokenize(ownHead)
    if (ownTokens.length === 0) {
      commentLine(lineNo, raw, split.comment ?? '')
      return
    }
    const leading = block
    block = emptyBlock()
    const comment = combineComment(leading.texts, split.comment)
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      stack.pop()
    }
    const frame = stack[stack.length - 1]
    const inherited = frame?.prefix
    const tokens = inherited === undefined ?
      ownTokens :
      [...inherited.tokens, ...ownTokens]
    const head = inherited === undefined ?
      ownHead :
      `${inherited.head} ${ownHead}`
    const semanticDepth = inherited?.semanticDepth ?? depth
    const parent = inherited === undefined ? frame?.index : inherited.parent
    const expanded = inherited !== undefined ?
      Token.joinComment(head, comment) :
      leading.raws.length > 0 ? [...leading.raws, raw].join('\n') : undefined
    const asPrefix = (message: string): boolean => {
      if (!hasIndentedContent(rawLines, at, depth)) {
        problem(lineNo, raw, message)
        lines.push({ kind: 'invalid', line: lineNo, raw, message })
        return false
      }
      const index = lines.length
      const prefix: Prefix = { tokens, head, semanticDepth, ...parent === undefined ? {} : { parent } }
      lines.push({
        kind: 'prefix',
        line: lineNo,
        raw,
        depth,
        expanded: head,
        ...parent === undefined ? {} : { parent },
        ...comment === undefined ? {} : { comment }
      })
      stack.push({ index, depth, prefix })
      return true
    }
    const kind = classify(tokens, semanticDepth)
    if (typeof kind === 'object') {
      asPrefix(kind.error)
      return
    }
    if (parent === undefined && kind !== 'claim') {
      const message = `${kind} line has no parent claim above (spec §8)`
      asPrefix(message)
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
          asPrefix(result.message)
          return
        }
        push(
          {
            kind: 'claim',
            line: lineNo,
            raw,
            depth,
            ...expanded === undefined ? {} : { expanded },
            ...parent !== undefined ? { parent } : {},
            claim: result.value
          },
          result.problems
        )
        return
      }
      case 'continuation': {
        const result = Line.parseBody(tokens, comment)
        if (!result.ok) {
          asPrefix(result.message)
          return
        }
        push(
          {
            kind: 'continuation',
            line: lineNo,
            raw,
            depth,
            parent: parent!,
            ...expanded === undefined ? {} : { expanded },
            body: result.value
          },
          result.problems
        )
        return
      }
      case 'qualifier': {
        const qualifier = (tokens[0] as { text: string }).text as Verb.Qualifier
        const result = Line.parseQualifierPayload(tokens.slice(1), comment)
        if (!result.ok) {
          asPrefix(result.message)
          return
        }
        push(
          {
            kind: 'qualifier',
            line: lineNo,
            raw,
            depth,
            parent: parent!,
            ...expanded === undefined ? {} : { expanded },
            qualifier,
            payload: result.value
          },
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
