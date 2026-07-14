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

import { Uuidv7 } from '@cavelang/core'
import { emitClaim } from '@cavelang/canonical'
import { Pattern, query } from '@cavelang/query'
import type { Match } from '@cavelang/query'
import { Row } from '@cavelang/store'
import type { Store } from '@cavelang/store'

export type Problem = {
  /** 1-based template line of the query that failed. */
  readonly line: number
  readonly message: string
}

export type ReportOptions = {
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
 * space pads content that begins or ends with a backtick (CommonMark
 * strips the pair back out).
 */
const toCodeSpan = (text: string): string => {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(run => run[0].length))
  const delimiter = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${delimiter}${pad}${text}${pad}${delimiter}`
}

/**
 * Substitutes `?var` occurrences with bindings, longest names first so
 * `?who` never clips `?who2`; a token no binding matches passes through
 * untouched (fragments are prose — the §29.3 convention).
 */
const substitute = (fragment: string, bindings: Readonly<Record<string, string>>): string => {
  let text = fragment
  for (const name of Object.keys(bindings).sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(`\\?${escapeRegExp(name)}(?![A-Za-z0-9_-])`, 'g'), () => bindings[name]!)
  }
  return text
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
    match[1]![0] === fence[0] && match[1]!.length >= fence.length && match[2]!.trim() === ''
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
  const lines = [...blockLines]
  while (lines.length > 0 && lines[0]!.trim() === '') {
    lines.shift()
    startLine += 1
  }
  if (lines.length === 0) {
    renderer.problem(startLine, 'empty cave-q block — a CAVE-Q pattern is required (spec §31.1)')
    return [invalidQuery]
  }
  const queryLines = [lines[0]!]
  let at = 1
  while (at < lines.length && lines[at]!.trim().startsWith('WHERE ')) {
    queryLines.push(lines[at]!)
    at += 1
  }
  const fragmentLines = lines.slice(at)
  while (fragmentLines.length > 0 && fragmentLines[0]!.trim() === '') {
    fragmentLines.shift()
  }
  const fragment = fragmentLines.some(line => line.trim() !== '') ? fragmentLines.join('\n') : undefined

  const matches = renderer.run(queryLines.join('\n'), startLine)
  if (matches === undefined) {
    return [invalidQuery]
  }
  const out: string[] = []
  for (const match of matches) {
    let instance: string
    if (fragment === undefined) {
      const bindings = Object.entries(match.bindings)
        .map(([name, value]) => `?${name} = ${value}`)
        .join('  ')
      // A fully bound pattern has nothing to bind — the claim itself is
      // the point (mirroring `cave query`'s rendering).
      instance = `- ${bindings !== '' ? bindings : toCodeSpan(match.row?.raw_line ?? queryLines[0]!.trim())} ${placeholder}`
    } else {
      instance = substitute(fragment, match.bindings)
    }
    if (match.row !== undefined) {
      const marker = renderer.cite(match.row)
      if (instance.includes(placeholder)) {
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
    } else {
      // Transitive solutions carry no row (§24.2's rule) — nothing to cite.
      instance = instance.replace(/[ \t]*\[\^\?\]/g, '')
    }
    out.push(...instance.split('\n'))
  }
  return out
}

/** A code span on one line: `[start, end)` offsets, delimiters included. */
type CodeSpan = {
  readonly start: number
  readonly end: number
  /** Content after CommonMark normalization (one padding space stripped). */
  readonly content: string
}

/**
 * Scans one line for Markdown code spans (CommonMark 6.1): a span opens
 * with a backtick run and closes at the next run of exactly the same
 * length — longer and shorter runs in between are content, an opener
 * with no closer is literal text. Content that both begins and ends
 * with a space (and isn't all spaces) loses one from each end, the
 * escape hatch that lets content begin or end with a backtick.
 */
const codeSpans = (line: string): CodeSpan[] => {
  const spans: CodeSpan[] = []
  let at = 0
  while (at < line.length) {
    const start = line.indexOf('`', at)
    if (start === -1) {
      break
    }
    let opened = start + 1
    while (opened < line.length && line[opened] === '`') {
      opened += 1
    }
    const length = opened - start
    let close = -1
    for (let search = opened; search < line.length;) {
      const candidate = line.indexOf('`', search)
      if (candidate === -1) {
        break
      }
      let candidateEnd = candidate + 1
      while (candidateEnd < line.length && line[candidateEnd] === '`') {
        candidateEnd += 1
      }
      if (candidateEnd - candidate === length) {
        close = candidate
        break
      }
      search = candidateEnd
    }
    if (close === -1) {
      at = opened
      continue
    }
    let content = line.slice(opened, close)
    if (content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) {
      content = content.slice(1, -1)
    }
    spans.push({ start, end: close + length, content })
    at = close + length
  }
  return spans
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
    renderer.problem(lineNo, error instanceof Error ? error.message : String(error))
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

/**
 * Splices on one prose line: each code span whose content starts with
 * `cave-q:` — whatever its delimiter length, so patterns may carry
 * backtick code literals — is replaced by its splice rendering; other
 * spans and the text between pass through untouched.
 */
const renderInline = (line: string, lineNo: number, renderer: Renderer): string => {
  let out = ''
  let at = 0
  for (const span of codeSpans(line)) {
    out += line.slice(at, span.start)
    out += span.content.startsWith(splicePrefix)
      ? renderSplice(span.content.slice(splicePrefix.length), lineNo, renderer)
      : line.slice(span.start, span.end)
    at = span.end
  }
  return out + line.slice(at)
}

/**
 * Renders a report template against a store (spec §31): markdown in,
 * markdown out — query blocks and inline splices resolved, citations
 * appended as footnote definitions. Problems don't stop the render;
 * they mark the text and are returned with template line numbers.
 */
export const report = (store: Store, template: string, options: ReportOptions = {}): Report => {
  const problems: Problem[] = []
  /** Footnote number per cited row id — repeats share a marker. */
  const numbers = new Map<string, number>()
  const definitions: string[] = []

  const cite = (row: Row.t): string => {
    const existing = numbers.get(row.id)
    if (existing !== undefined) {
      return `[^c${existing}]`
    }
    const number = numbers.size + 1
    numbers.set(row.id, number)
    const contexts = (store.db.prepare('SELECT context FROM cave_context WHERE claim_id = ?').all(row.id) as
      { context: string }[]).map(entry => entry.context)
    const tags = store.db.prepare('SELECT key, value FROM cave_tag WHERE claim_id = ?').all(row.id) as
      { key: string, value: null | string }[]
    // The canonical line (§16's emitter over the stored row) rather than
    // raw_line: §9.5 stamps live in the context table, and a citation
    // must show provenance the authored abbreviation would hide.
    const canonical = emitClaim(Row.toClaim(row, contexts, tags))
    const date = new Date(Uuidv7.msOf(row.tx)).toISOString().slice(0, 10)
    definitions.push(`[^c${number}]: ${toCodeSpan(canonical)} — ${date}, claim key ${toCodeSpan(row.claim_key)}`)
    return `[^c${number}]`
  }

  const renderer: Renderer = {
    cite,
    problem: (line, message) => problems.push({ line, message }),
    run: (queryText, line) => {
      try {
        return query(store, queryText, {
          ...options.aliases === true ? { aliases: true } : {},
          ...options.resolve === true ? { resolve: true } : {},
          ...options.asOf === undefined ? {} : { asOf: options.asOf },
          ...options.at === undefined ? {} : { at: options.at }
        })
      } catch (error) {
        problems.push({ line, message: error instanceof Error ? error.message : String(error) })
        return undefined
      }
    }
  }

  const lines = template.split(/\r?\n/)
  const out: string[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]!
    const fence = fenceRe.exec(line)
    if (fence !== null && fence[2]!.trim() !== '' && fence[2]!.trim().split(/\s+/)[0] === 'cave-q') {
      const blockStart = at + 1
      const blockLines: string[] = []
      at += 1
      while (at < lines.length && !closesFence(lines[at]!, fence[1]!)) {
        blockLines.push(lines[at]!)
        at += 1
      }
      if (at >= lines.length) {
        problems.push({ line: blockStart, message: 'unclosed cave-q block' })
      } else {
        at += 1 // the closing fence
      }
      out.push(...renderBlock(blockLines, blockStart + 1, renderer))
      continue
    }
    if (fence !== null) {
      // Any other fenced block passes through verbatim — its content is
      // code, so inline splices inside it never fire.
      out.push(line)
      at += 1
      while (at < lines.length) {
        out.push(lines[at]!)
        if (closesFence(lines[at]!, fence[1]!)) {
          at += 1
          break
        }
        at += 1
      }
      continue
    }
    out.push(renderInline(line, at + 1, renderer))
    at += 1
  }

  // One newline ends the document — the template's own EOF blank lines
  // (and the split's trailing empty element) normalize away.
  while (out.length > 0 && out[out.length - 1]!.trim() === '') {
    out.pop()
  }
  if (definitions.length > 0) {
    out.push('', ...definitions)
  }
  const body = out.join('\n')
  const markdown = body === '' ? '' : `${body}\n`
  return { markdown, citations: definitions.length, problems }
}
