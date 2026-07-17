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

import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import type { Store } from '@cavelang/store'
import { digestOf, isIngested } from './files.ts'
import type { Selected, Selection } from './files.ts'

/** @returns whether an ingest pattern is a fetchable URL. */
export const isUrl = (pattern: string): boolean =>
  /^https?:\/\//i.test(pattern)

/** Block-level elements worth a line of their own in the extracted text. */
const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, figcaption'

const headingPrefix: Readonly<Record<string, string>> = {
  H1: '# ', H2: '## ', H3: '### ', H4: '#### ', H5: '##### ', H6: '###### ', LI: '- '
}

type ElementLike = {
  readonly tagName: string
  readonly textContent: string | null
  readonly parentElement: ElementLike | null
  closest(selector: string): unknown
  remove(): void
}

type RootLike = {
  readonly textContent: string | null
  querySelectorAll(selector: string): Iterable<ElementLike>
}

/** Readability's types are written against the browser DOM lib, which a
 * node-only tsconfig does not load — retype the constructor structurally. */
const Parser = Readability as unknown as new (document: unknown) =>
  { parse(): null | { title: string | null | undefined, content: string | null | undefined } }

/** Flattens a DOM subtree into markdown-ish text, one block per line. */
const textOf = (root: RootLike): string => {
  const blocks = [...root.querySelectorAll(blockSelector)]
    // Keep outermost blocks only — a <p> inside a kept <li> is its text.
    .filter(element => element.parentElement === null || element.parentElement.closest(blockSelector) === null)
    .map(element => {
      const text = element.textContent ?? ''
      return element.tagName === 'PRE' ?
        text.trim() :
        `${headingPrefix[element.tagName] ?? ''}${text.replace(/\s+/g, ' ').trim()}`
    })
    .filter(line => line !== '')
  return blocks.length > 0 ? blocks.join('\n\n') : (root.textContent ?? '').trim()
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
    textOf(parseHTML(`<html><body>${article.content}</body></html>`).document as unknown as RootLike)
  const title = (article?.title ?? parse().title ?? '').trim()
  return title === '' || text.startsWith(`# ${title}`) ? text : `# ${title}\n\n${text}`
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
  const detail = error instanceof Error ? error.message : String(error)
  return { path: url, kind: 'network', retryable: true, message: `fetch ${url} failed: ${detail}` }
}

/**
 * Fetches one URL and returns it as a selectable source — readable text
 * for HTML responses, the verbatim body for anything else.
 */
export const fetchDocument = async (
  url: string,
  fetchImpl: FetchLike = fetch,
  timeoutSeconds = 60
): Promise<Selected> => {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        'user-agent': 'cave-ingest',
        accept: 'text/html, text/markdown, text/plain, application/json;q=0.9, */*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutSeconds * 1000)
    })
  } catch (error) {
    throw new FetchFailure(failureOf(url, error))
  }
  if (!response.ok) {
    throw new FetchFailure({
      path: url,
      kind: 'http',
      retryable: retryableStatus(response.status),
      status: response.status,
      message: `fetch ${url} failed: ${response.status} ${response.statusText}`
    })
  }
  const type = response.headers.get('content-type') ?? ''
  const body = await response.text()
  const html = /html|xhtml/i.test(type) || (type === '' && /^\s*</.test(body))
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
  options: { force?: boolean, fetchImpl?: FetchLike } = {}
): Promise<Selection & { failures: readonly Failure[] }> => {
  const files: Selected[] = []
  const skipped: string[] = []
  const failures: Failure[] = []
  const outcomes: ({ document: Selected } | { failure: Failure })[] = await Promise.all([...new Set(urls)].map(async url => {
    try {
      return { document: await fetchDocument(url, options.fetchImpl) }
    } catch (error) {
      return { failure: failureOf(url, error) }
    }
  }))
  for (const outcome of outcomes) {
    if ('failure' in outcome) {
      failures.push(outcome.failure)
      continue
    }
    const document = outcome.document
    if (options.force !== true && isIngested(store, document.path, document.digest)) {
      skipped.push(document.path)
    } else {
      files.push(document)
    }
  }
  return { files, skipped, failures }
}
