import { booleanOption, sourceList } from './options.ts'
/**
 * URL sources for ingestion — `cave ingest https://…` fetches the page
 * with the built-in fetch and reduces HTML to its readable article text
 * (Readability over linkedom), so the agent sees prose instead of markup.
 * Non-HTML responses (markdown, plain text, JSON) pass through verbatim.
 *
 * Provenance mirrors files: the URL is the claim subject and the digest
 * is taken over the *extracted* text, so a page is re-ingested only when
 * its readable content changes — not on every markup or chrome tweak.
 */

import { errorMessage } from './error-message.ts'
import { sourceLabel } from './content.ts'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import type { Store } from '@cavelang/store'
import { digestOf, isIngested } from './files.ts'
import type { Selected, Selection } from './files.ts'
import { agentTimeoutMs } from './timeout.ts'

/** @returns whether an ingest pattern is a fetchable URL. */
export const isUrl = (pattern: string): boolean =>
  /^https?:\/\//i.test(pattern)

/** Block-level elements worth a line of their own in the extracted text. */
const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, th, td, caption, dt, dd, figcaption, address'

// Structural containers separate text but do not absorb nested headings or code.
const containerSelector = 'div, section, article, main, header, footer, aside, nav, figure, details, summary, form, fieldset, ul, ol, dl, table, thead, tbody, tfoot, tr'

const headingPrefix: Readonly<Record<string, string>> = {
  H1: '# ', H2: '## ', H3: '### ', H4: '#### ', H5: '##### ', H6: '###### ', LI: '- '
}

type NodeLike = {
  readonly nodeType: number
  readonly textContent: string | null
  readonly firstChild: NodeLike | null
  readonly nextSibling: NodeLike | null
}

type ElementLike = NodeLike & {
  readonly tagName: string
  readonly textContent: string | null
  readonly parentElement: ElementLike | null
  closest(selector: string): unknown
  remove(): void
  replaceWith(text: string): void
  before(text: string): void
  after(text: string): void
}

type RootLike = NodeLike & {
  readonly textContent: string | null
  querySelectorAll(selector: string): Iterable<ElementLike>
}

/** Readability's types are written against the browser DOM lib, which a
 * node-only tsconfig does not load — retype the constructor structurally. */
const Parser = Readability as unknown as new (document: unknown) =>
  { parse(): null | { title: string | null | undefined, content: string | null | undefined } }

/** Flattens a DOM subtree into markdown-ish text, one block per line. */
const textOf = (root: RootLike): string => {
  for (const lineBreak of root.querySelectorAll('br')) lineBreak.replaceWith('\n')
  const elements = [...root.querySelectorAll(blockSelector)]
  // textContent does not separate adjacent blocks. Keep nested content in its
  // outer block, but retain word boundaries before flattening its whitespace.
  for (const element of [...elements, ...root.querySelectorAll(containerSelector)]) {
    if (element.parentElement?.closest(blockSelector) != null) {
      element.before('\n')
      element.after('\n')
    }
  }
  const blocks = new Map<NodeLike, string>(elements
    // Keep outermost blocks only — a <p> inside a kept <li> is its text.
    .filter(element => element.parentElement === null || element.parentElement.closest(blockSelector) === null)
    .map(element => {
      const text = element.textContent ?? ''
      if (element.tagName === 'PRE') return [element, text]
      const content = text.replace(/\s+/g, ' ').trim()
      return [element, content === '' ? '' : `${headingPrefix[element.tagName] ?? ''}${content}`]
    }))
  const containers = new Set<NodeLike>(root.querySelectorAll(containerSelector))
  if (blocks.size === 0 && containers.size === 0) return (root.textContent ?? '').trim()
  const output: string[] = []
  let pending: string[] = []
  const flush = () => {
    const text = pending.join('').replace(/\s+/g, ' ').trim()
    if (text !== '') output.push(text)
    pending = []
  }
  // Traverse iteratively and skip the descendants of emitted blocks. Text
  // between those blocks belongs to the retained article too.
  const stack: (NodeLike | null)[] = root.firstChild === null ? [] : [root.firstChild]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node === null) {
      flush()
      continue
    }
    if (node.nextSibling !== null) stack.push(node.nextSibling)
    const block = blocks.get(node)
    if (block !== undefined) {
      flush()
      if (block !== '') output.push(block)
    } else if (node.nodeType === 3) {
      pending.push(node.textContent ?? '')
    } else if (node.nodeType === 1 && node.firstChild !== null) {
      if (containers.has(node)) {
        flush()
        stack.push(null)
      }
      stack.push(node.firstChild)
    }
  }
  flush()
  return output.join('\n\n')
}

/**
 * @returns the readable text of an HTML page — Readability's article when
 * it finds one, otherwise the whole body with scripts/styles dropped —
 * prefixed with the page title as a heading.
 */
export const readableTextOf = (html: string): string => {
  const parse = () => parseHTML(html).document
  const article = new Parser(parse()).parse()
  const body = (): string => {
    const document = parse()
    for (const element of document.querySelectorAll('script, style, noscript, template') as Iterable<ElementLike>) {
      element.remove()
    }
    return textOf((document.body ?? document) as RootLike)
  }
  const text = article === null || article.content === null || article.content === undefined ?
    body() :
    textOf(parseHTML(`<html><body>${article.content}</body></html>`).document.body as unknown as RootLike)
  const title = (article?.title ?? parse().title ?? '').trim()
  const heading = `# ${title}`
  if (title === '' || text === heading || text.startsWith(`${heading}\n`)) return text
  return text === '' ? heading : `${heading}\n\n${text}`
}

/** Injection point for tests; the built-in fetch otherwise. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type FailureKind = 'network' | 'http'

export type Failure = {
  readonly path: string
  readonly kind: FailureKind
  readonly retryable: boolean
  readonly message: string
  readonly status?: number
}

class FetchFailure extends Error {
  readonly failure: Failure

  constructor(failure: Failure) {
    super(failure.message)
    this.failure = failure
  }
}

const retryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500

const failureOf = (url: string, error: unknown): Failure => {
  if (error instanceof FetchFailure) return error.failure
  const detail = errorMessage(error)
  return { path: url, kind: 'network', retryable: true, message: `fetch ${sourceLabel(url)} failed: ${sourceLabel(detail)}` }
}

/**
 * Fetches one URL and returns it as a selectable source — readable text
 * for HTML responses, the verbatim body for anything else.
 */
export const fetchDocument = async (
  url: string,
  fetchImpl: FetchLike = fetch,
  timeoutSeconds = 60,
  signal?: AbortSignal
): Promise<Selected> => {
  signal?.throwIfAborted()
  if (/[\uD800-\uDFFF]/u.test(url)) {
    throw new TypeError('URL must contain well-formed Unicode')
  }
  const timeoutMs = agentTimeoutMs(timeoutSeconds, true)
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        'user-agent': 'cave-ingest',
        accept: 'text/html, text/markdown, text/plain, application/json;q=0.9, */*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...signal === undefined ? [] : [signal]
      ])
    })
  } catch (error) {
    signal?.throwIfAborted()
    throw new FetchFailure(failureOf(url, error))
  }
  if (signal?.aborted) {
    await response.body?.cancel().catch(() => undefined)
    signal.throwIfAborted()
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    signal?.throwIfAborted()
    throw new FetchFailure({
      path: url,
      kind: 'http',
      retryable: retryableStatus(response.status),
      status: response.status,
      message: `fetch ${sourceLabel(url)} failed: ${response.status} ${sourceLabel(response.statusText)}`
    })
  }
  const type = (response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase()
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
  signal?.throwIfAborted()
  let body: string
  try {
    body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (cause) {
    throw new FetchFailure(failureOf(url, new TypeError('invalid UTF-8 response body', { cause })))
  }
  const html = type === 'text/html' || type === 'application/xhtml+xml' ||
    (type === '' && /^\s*</.test(body))
  const content = html ? readableTextOf(body) : body
  return { path: url, digest: digestOf(content), content }
}

/**
 * Fetches and digests the given URLs, skipping the ones whose current
 * `ingest-digest` belief already matches (pass `force` to re-ingest all).
 * The fetch always happens — the digest is over the extracted content —
 * but unchanged pages cost no agent run.
 */
export const select = async (
  store: Store,
  urls: readonly string[],
  options: { force?: boolean, fetchImpl?: FetchLike, signal?: AbortSignal } = {}
): Promise<Selection & { failures: readonly Failure[] }> => {
  const signal = options.signal
  signal?.throwIfAborted()
  const force = booleanOption(options.force, 'force')
  const fetchImpl = options.fetchImpl
  const files: Selected[] = []
  const skipped: string[] = []
  const failures: Failure[] = []
  const selected = [...new Set(sourceList(urls, 'URLs'))]
  const outcomes: ({ document: Selected } | { failure: Failure })[] = new Array(selected.length)
  let next = 0
  // Bound in-flight requests while retaining input order for reports and batches.
  await Promise.all(Array.from({ length: Math.min(8, selected.length) }, async () => {
    while (next < selected.length) {
      signal?.throwIfAborted()
      const index = next++
      const url = selected[index]!
      try {
        outcomes[index] = { document: await fetchDocument(url, fetchImpl, 60, signal) }
      } catch (error) {
        signal?.throwIfAborted()
        outcomes[index] = { failure: failureOf(url, error) }
      }
    }
  }))
  signal?.throwIfAborted()
  for (const outcome of outcomes) {
    if ('failure' in outcome) {
      failures.push(outcome.failure)
      continue
    }
    const document = outcome.document
    if (force !== true && isIngested(store, document.path, document.digest)) {
      skipped.push(document.path)
    } else {
      files.push(document)
    }
  }
  return { files, skipped, failures }
}
