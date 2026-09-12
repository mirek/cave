/**
 * `cave report` (spec §31) — templated markdown rendered from CAVE-Q
 * results, claim keys as citations.
 *
 * A template is an ordinary markdown document with two live constructs:
 *
 * - a fenced ```cave-q block — first line a CAVE-Q pattern (§12.1),
 *   following `WHERE` lines its filters (§12.2), the rest a markdown
 *   fragment rendered once per solution with `?var` bindings
 *   substituted (no fragment: the solution as `cave query` prints it,
 *   as a cited bullet);
 * - an inline `` `cave-q: <pattern>` `` splice — a code span of any
 *   delimiter length (```` ``cave-q: …`` ```` when the pattern carries a
 *   backtick code literal), exactly one variable, exactly one solution,
 *   replaced by the bound value; anything else is a problem (§25.2's
 *   determinism, and `--resolve` is the knob when sources contest the
 *   fact, §26).
 *
 * Every solution that matched a stored row cites it: `[^cN]` footnote
 * markers land at the fragment's `[^?]` placeholder (appended when
 * absent), and the definitions — the row's canonical line, tx date and
 * claim key (§9.2) — collect at the end of the document, one per row.
 * Everything else in the template passes through verbatim, other fenced
 * blocks included.
 */

import { maximumSensitivity } from './sensitivity.ts'
import { Key, SourceSpan, Uuidv7 } from '@cavelang/core'
import { emitClaim } from '@cavelang/canonical'
import { Pattern, query } from '@cavelang/query'
import type { Match } from '@cavelang/query'
import { Row } from '@cavelang/store'
import { Sensitivity } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { withScopedStore } from './scope.ts'
import { errorMessage } from './error-message.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'

export type Problem = {
  /** 1-based template line of the query that failed. */
  readonly line: number
  readonly message: string
}

export type ReportOptions = {
  /** Highest sensitivity level allowed in the deliverable (default `internal`, spec §9.7). */
  readonly maxSensitivity?: Sensitivity.Level
  /** Queries match through the §13.6 alias closure. */
  readonly aliases?: boolean
  /** Queries match resolved winners only (spec §26). */
  readonly resolve?: boolean
  /** Queries resolve beliefs as of a past moment (spec §12.3). */
  readonly asOf?: string
  /** Queries anchor in valid time (spec §32.4): time-scoped claims filter, trajectories interpolate. */
  readonly at?: string
}

export type Report = {
  readonly markdown: string
  /** Distinct rows cited — the number of footnote definitions. */
  readonly citations: number
  readonly problems: readonly Problem[]
}

/** The fragment's citation placeholder — replaced by the `[^cN]` marker. */
const placeholder = '[^?]'

/**
 * The in-document marker for a block or splice whose query never ran —
 * §31.3's contract: the document still emits, problems marked in place.
 */
const invalidQuery = '*(invalid query)*'

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Wraps store text as a Markdown code span that survives its own
 * backticks: the delimiter outruns the longest run inside by one, and a
 * space pads content that begins or ends with a backtick, or has spaces
 * at both ends (CommonMark strips one pair unless the content is all spaces).
 */
const toCodeSpan = (text: string): string => {
  let longest = 0
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  const delimiter = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) ? ' ' : ''
  return `${delimiter}${pad}${text}${pad}${delimiter}`
}

const sourceLink = (reference: SourceSpan.Reference): string => {
  // Decoded source identities can contain controls. Keep the label on one
  // line while leaving the stored identity and encoded URL unchanged.
  const location = reference.location.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, char =>
    char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' :
      `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return reference.href === undefined ?
    toCodeSpan(location) :
    `[${location.replace(/[\\`*_\[\]<>&]/g, char => `\\${char}`)}](<${reference.href.replaceAll('&', '&amp;').replaceAll('>', '%3E')}>)`
}

/**
 * Substitutes template occurrences once; inserted values are never scanned.
 * Longest names win, and unknown tokens pass through untouched.
 */
const substitute = (fragment: string, bindings: Readonly<Record<string, string>>): string => {
  const names = Object.keys(bindings).sort((a, b) => b.length - a.length)
  if (names.length === 0) return fragment
  const tokens = new RegExp(`\\?(${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{M}\\p{N}_-])`, 'gu')
  return fragment.replace(tokens, (_token, name: string) => bindings[name]!)
}

/** Distinct `?var` names of a parsed pattern, in slot order. */
const variablesOf = (pattern: Pattern.t): string[] => {
  const names: string[] = []
  const add = (slot: { kind: string, name?: string }): void => {
    if (slot.kind === 'var' && slot.name !== undefined && !names.includes(slot.name)) {
      names.push(slot.name)
    }
  }
  add(pattern.subject)
  add(pattern.verb)
  if (pattern.payload.kind === 'object') {
    add(pattern.payload.object)
  } else if (pattern.payload.kind === 'attribute') {
    add(pattern.payload.value)
  }
  return names
}

/** Fence line: ``` or ~~~ (3+, up to 3 leading spaces) plus an info string. */
const fenceRe = /^ {0,3}(`{3,}|~{3,})(.*)$/

const closesFence = (line: string, fence: string): boolean => {
  const match = fenceRe.exec(line)
  return match !== null &&
    match[1]![0] === fence[0] && match[1]!.length >= fence.length && /^[ \t]*$/.test(match[2]!)
}

type InlineSplice = {
  readonly startColumn: number
  readonly endLine: number
  readonly endColumn: number
  readonly content: string
}

/** Locate live spans and literal regions without reserializing the template. */
const templateBoundaries = (template: string, lines: readonly string[]): {
  inert: Set<number>, blocks: ReadonlyMap<number, { endLine: number, fence: string }>, splices: ReadonlyMap<number, readonly InlineSplice[]>
} => {
  type Node = ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>['children'][number]
  const tree = fromMarkdown(template, {
    extensions: [gfmFootnote()], mdastExtensions: [gfmFootnoteFromMarkdown()]
  })
  const pending: Node[] = [tree]
  const topLevel = new Set<Node>(tree.children)
  const inert = new Set<number>()
  const blocks = new Map<number, { endLine: number, fence: string }>()
  const splices = new Map<number, InlineSplice[]>()
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === 'inlineCode' && node.position !== undefined && node.value.startsWith(splicePrefix)) {
      const { start, end } = node.position
      const entries = splices.get(start.line - 1) ?? []
      entries.push({ startColumn: start.column - 1, endLine: end.line - 1,
        endColumn: end.column - 1, content: node.value.replace(/\r\n|\r|\n/g, ' ') })
      splices.set(start.line - 1, entries)
    }
    if (node.type === 'code' && node.position !== undefined) {
      const start = node.position.start.line - 1
      const fence = fenceRe.exec(lines[start]!)
      if (topLevel.has(node) && fence !== null && fence[2]!.trim().split(/\s+/)[0] === 'cave-q') {
        blocks.set(start, { endLine: node.position.end.line - 1, fence: fence[1]! })
      } else {
        for (let line = start; line < node.position.end.line; line++) inert.add(line)
      }
    }
    if ('children' in node) for (const child of node.children) pending.push(child)
  }
  for (const entries of splices.values()) entries.sort((a, b) => a.startColumn - b.startColumn)
  return { inert, blocks, splices }
}

type Renderer = {
  readonly cite: (row: Row.t) => string
  readonly problem: (line: number, message: string) => void
  readonly run: (queryText: string, line: number) => undefined | Match[]
}

/**
 * One query block (spec §31.1): pattern, `WHERE` filters, fragment.
 * Renders one fragment instance per solution — the default fragment is
 * the solution as `cave query` prints it, as a cited bullet.
 */
const renderBlock = (blockLines: readonly string[], startLine: number, renderer: Renderer): string[] => {
  let first = 0
  while (first < blockLines.length && blockLines[first]!.trim() === '') first += 1
  startLine += first
  if (first === blockLines.length) {
    renderer.problem(startLine, 'empty cave-q block — a CAVE-Q pattern is required (spec §31.1)')
    return [invalidQuery]
  }
  const lines = blockLines.slice(first)
  const queryLines = [lines[0]!]
  let at = 1
  while (at < lines.length && /^WHERE(?:[ \t]|$)/.test(lines[at]!.trim())) {
    queryLines.push(lines[at]!)
    at += 1
  }
  while (at < lines.length && lines[at]!.trim() === '') at += 1
  const fragment = at < lines.length ? lines.slice(at).join('\n') : undefined

  const matches = renderer.run(queryLines.join('\n'), startLine)
  if (matches === undefined) {
    return [invalidQuery]
  }
  const out: string[] = []
  for (const match of matches) {
    const marker = match.row === undefined ? '' : renderer.cite(match.row)
    let instance: string
    if (fragment === undefined) {
      const bindings = Object.entries(match.bindings)
        .map(([name, value]) => `?${name} = ${value}`)
        .join('  ')
      // A fully bound pattern has nothing to bind — the claim itself is
      // the point (mirroring `cave query`'s rendering).
      instance = `- ${bindings !== '' ? bindings : toCodeSpan(match.row?.raw_line ?? queryLines[0]!.trim())}${marker === '' ? '' : ` ${marker}`}`
    } else {
      // Citation placeholders belong to the authored template, never to data
      // inserted from the store. Resolve them before substituting bindings.
      instance = fragment
      if (match.row === undefined) {
        instance = instance.replace(/[ \t]*\[\^\?\]/g, '')
      } else if (instance.includes(placeholder)) {
        instance = instance.replaceAll(placeholder, marker)
      } else {
        // Append to the last non-blank line, so a paragraph fragment's
        // trailing blank separator stays a separator.
        const instanceLines = instance.split('\n')
        for (let i = instanceLines.length - 1; i >= 0; i--) {
          if (instanceLines[i]!.trim() !== '') {
            instanceLines[i] = `${instanceLines[i]} ${marker}`
            break
          }
        }
        instance = instanceLines.join('\n')
      }
      instance = substitute(instance, match.bindings)
    }
    for (const line of instance.split('\n')) out.push(line)
  }
  return out
}

const splicePrefix = 'cave-q:'

/**
 * One inline splice (spec §31.1): exactly one variable, exactly one
 * solution — deterministic or nothing.
 */
const renderSplice = (patternText: string, lineNo: number, renderer: Renderer): string => {
  let names: string[]
  try {
    names = variablesOf(Pattern.parse(patternText))
  } catch (error) {
    renderer.problem(lineNo, errorMessage(error))
    return invalidQuery
  }
  if (names.length !== 1) {
    renderer.problem(lineNo, `an inline splice needs exactly one ?variable, got ${names.length} (spec §31.1)`)
    return invalidQuery
  }
  const matches = renderer.run(patternText, lineNo)
  if (matches === undefined) {
    return invalidQuery
  }
  if (matches.length === 0) {
    renderer.problem(lineNo, `no match for inline splice ${JSON.stringify(patternText.trim())}`)
    return '*(no match)*'
  }
  if (matches.length > 1) {
    renderer.problem(lineNo,
      `ambiguous inline splice ${JSON.stringify(patternText.trim())}: ${matches.length} matches — ` +
      'several series contest the fact; --resolve picks the §26 winner')
    return `*(ambiguous: ${matches.length} matches)*`
  }
  const match = matches[0]!
  const value = match.bindings[names[0]!]!
  return match.row === undefined ? value : `${value}${renderer.cite(match.row)}`
}

/** Render parsed spans, preserving source outside their exact boundaries. */
const renderInline = (lines: readonly string[], startLine: number,
  splices: ReadonlyMap<number, readonly InlineSplice[]>, renderer: Renderer): { text: string, endLine: number } => {
  let line = startLine
  let column = 0
  let index = 0
  let out = ''
  while (true) {
    const span = splices.get(line)?.[index]
    if (span === undefined) return { text: out + lines[line]!.slice(column), endLine: line }
    out += lines[line]!.slice(column, span.startColumn)
    out += renderSplice(span.content.slice(splicePrefix.length), line + 1, renderer)
    column = span.endColumn
    if (span.endLine === line) index += 1
    else {
      line = span.endLine
      index = 0
    }
  }
}

/**
 * Renders a report template against a store (spec §31): markdown in,
 * markdown out — query blocks and inline splices resolved, citations
 * appended as footnote definitions. Problems don't stop the render;
 * they mark the text and are returned with template line numbers.
 */
const renderReport = (store: Store, template: string, options: ReportOptions): Report => {
  const problems: Problem[] = []
  /** Footnote number per cited row id — repeats share a marker. */
  const numbers = new Map<string, number>()
  const definitions: string[] = []
  // Reserve label occurrences throughout the original template, including
  // case variants and code examples, before assigning any generated labels.
  const reserved = new Set([...template.matchAll(/\[\^\s*(c[1-9][0-9]*)\s*\]/gi)]
    .map(match => match[1]!.toLowerCase()))
  let nextNumber = 1

  const cite = (row: Row.t): string => {
    const existing = numbers.get(row.id)
    if (existing !== undefined) {
      return `[^c${existing}]`
    }
    while (reserved.has(`c${nextNumber}`)) nextNumber += 1
    const number = nextNumber++
    numbers.set(row.id, number)
    const contexts = (store.db.prepare('SELECT context FROM cave_context WHERE claim_id = ?').all(row.id) as
      { context: string }[]).map(entry => entry.context)
    const tags = store.db.prepare('SELECT key, value FROM cave_tag WHERE claim_id = ?').all(row.id) as
      { key: string, value: null | string }[]
    // The canonical line (§16's emitter over the stored row) rather than
    // raw_line: §9.5 stamps live in the context table, and a citation
    // must show provenance the authored abbreviation would hide.
    // A code span holds one line: a multi-line comment (§6.4) folds its
    // lines with ` / ` instead of opening above the claim as in CAVE text.
    if (typeof row.id !== 'string' || !Uuidv7.is(row.id) || row.tx !== row.id) {
      throw new Error('stored transaction identity must be a canonical lowercase UUIDv7 with id = tx')
    }
    const claim = Row.toClaim(row, contexts, tags)
    const canonical = claim.comment === undefined ?
      emitClaim(claim) :
      `${emitClaim({ ...claim, comment: undefined })} ; ${claim.comment.split(/\r\n|\r|\n/).join(' / ')}`
    if (Key.of(claim) !== row.claim_key) {
      throw new Error('stored claim key does not agree with its semantic identity')
    }
    const date = new Date(Uuidv7.msOf(row.tx)).toISOString().split('T')[0]!
    const spans = SourceSpan.ofContexts(contexts).filter(reference => reference.span !== undefined)
    const provenance = spans.length === 0 ? '' : `, source ${spans.map(sourceLink).join(', ')}`
    definitions.push(`[^c${number}]: ${toCodeSpan(canonical)} — ${date}, claim key ${toCodeSpan(row.claim_key)}${provenance}`)
    return `[^c${number}]`
  }

  // A render uses one immutable scoped store and fixed query options. Retain
  // only the last successful query, avoiding a cache of every report result.
  let previousQuery: string | undefined
  let previousMatches: Match[] | undefined
  const renderer: Renderer = {
    cite: row => {
      try { return cite(row) }
      catch (error) {
        throw new Error(`CAVE report citation failed for claim ${row.id}: ${errorMessage(error)}`, { cause: error })
      }
    },
    problem: (line, message) => problems.push({ line, message }),
    run: (queryText, line) => {
      if (previousQuery === queryText && previousMatches !== undefined) return previousMatches
      previousQuery = undefined
      previousMatches = undefined
      try {
        const matches = query(store, queryText, {
          ...options.aliases === true ? { aliases: true } : {},
          ...options.resolve === true ? { resolve: true } : {},
          ...options.asOf === undefined ? {} : { asOf: options.asOf },
          ...options.at === undefined ? {} : { at: options.at }
        })
        previousQuery = queryText
        previousMatches = matches
        return matches
      } catch (error) {
        problems.push({ line, message: errorMessage(error) })
        return undefined
      }
    }
  }

  const lines = template.split(/\r\n|\r|\n/)
  const { inert, blocks, splices } = templateBoundaries(template, lines)
  const out: string[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]!
    if (inert.has(at)) {
      out.push(line)
      at += 1
      continue
    }
    const block = blocks.get(at)
    if (block !== undefined) {
      const blockStart = at + 1
      const closed = block.endLine > at && closesFence(lines[block.endLine]!, block.fence)
      const blockLines = lines.slice(at + 1, block.endLine + (closed ? 0 : 1))
      if (!closed) problems.push({ line: blockStart, message: 'unclosed cave-q block' })
      for (const line of renderBlock(blockLines, blockStart + 1, renderer)) out.push(line)
      at = block.endLine + 1
      continue
    }
    const rendered = renderInline(lines, at, splices, renderer)
    out.push(rendered.text)
    at = rendered.endLine + 1
  }

  // One newline ends the document — the template's own EOF blank lines
  // (and the split's trailing empty element) normalize away.
  while (out.length > 0 && out[out.length - 1]!.trim() === '') {
    out.pop()
  }
  if (definitions.length > 0) {
    out.push('')
    for (const definition of definitions) out.push(definition)
  }
  const body = out.join('\n')
  const markdown = body === '' ? '' : `${body}\n`
  return { markdown, citations: definitions.length, problems }
}

export const report = (store: Store, template: string, options: ReportOptions = {}): Report => {
  const { maxSensitivity, aliases, resolve, asOf, at } = options
  for (const [name, value] of [['aliases', aliases], ['resolve', resolve]] as const) {
    if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`)
  }
  const captured: ReportOptions = {
    ...aliases === undefined ? {} : { aliases },
    ...resolve === undefined ? {} : { resolve },
    ...asOf === undefined ? {} : { asOf },
    ...at === undefined ? {} : { at }
  }
  return withScopedStore(store, maximumSensitivity(maxSensitivity), scoped =>
    renderReport(scoped, template, captured))
}
