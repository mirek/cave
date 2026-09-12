/**
 * `cave serve` (spec §30.3) — the store behind a local HTTP server: the
 * §30.1 page at `/`, the §30.2 view models under `/api/*`. Strictly a
 * read surface: only GET/HEAD are answered (anything else is 405), no
 * route writes, and the page's CSP forbids every non-self source — the
 * browser can render the store but never mutate it or leak it.
 *
 * Binds 127.0.0.1 by default: the store is one person's knowledge on
 * one machine (§19), and serving it wider is an explicit `--host` act.
 */

import { maximumSensitivity } from './sensitivity.ts'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { Version } from '@cavelang/core'
import { Sensitivity } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { entity, history, lineage, overview, search, topic } from './api.ts'
import { page } from './page.ts'
import { errorMessage } from './error-message.ts'

/** `cave` on a phone keypad. */
export const defaultPort = 2283
export const defaultHost = '127.0.0.1'

export type ServeOptions = {
  /** Interface to bind (default {@link defaultHost} — localhost only). */
  readonly host?: string
  /** Port to bind (default {@link defaultPort}; `0` picks a free one). */
  readonly port?: number
  /** Store label shown on the page — typically the `--db` path. */
  readonly label?: string
  /** Highest sensitivity level served (default `internal`, spec §9.7). */
  readonly maxSensitivity?: Sensitivity.Level
}

export type Handle = {
  /** The root URL actually bound, e.g. `http://127.0.0.1:2283/`. */
  readonly url: string
  readonly server: Server
  close(): Promise<void>
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify(body))
}

const requiredParameters = new Map([
  ['/api/entity', 'name'], ['/api/topic', 'name'], ['/api/history', 'key'],
  ['/api/lineage', 'id'], ['/api/search', 'q']
])

/** A required query parameter, `undefined` when absent or blank. */
const param = (url: URL, name: string): undefined | string => {
  const value = url.searchParams.get(name)
  return value === null || value === '' ? undefined : value
}

const handler = (store: Store, label: string, maximum: Sensitivity.Level) => {
  const values: Readonly<Record<string, string>> = {
    DB: label, VERSION: Version.current(), SENSITIVITY: maximum
  }
  const html = page.replace(/__CAVE_(DB|VERSION|SENSITIVITY)__/g,
    (_marker, name: string) => escapeHtml(values[name]!))
  return (req: IncomingMessage, res: ServerResponse): void => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD')
        json(res, 405, { error: 'read-only surface — GET/HEAD only (spec §30.3)' })
        return
      }
      let url: URL
      try {
        url = new URL(req.url ?? '/', 'http://cave.local')
        // URLSearchParams replaces malformed UTF-8 instead of rejecting it.
        // Validate the encoded query first, without decoding its delimiters
        // or double-decoding values passed to the normal parameter parser.
        decodeURIComponent(url.search)
      } catch {
        json(res, 400, { error: 'invalid request URL' })
        return
      }
      const head = req.method === 'HEAD'
      if (url.pathname === '/') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
          // Self-contained (spec §30.1): inline style/script, same-origin
          // fetches, nothing else — the page cannot call out anywhere.
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:"
        })
        res.end(head ? undefined : html)
        return
      }
      if (!url.pathname.startsWith('/api/')) {
        json(res, 404, { error: `no such path: ${url.pathname}` })
        return
      }
      const required = requiredParameters.get(url.pathname)
      if (required !== undefined && url.searchParams.getAll(required).length > 1) {
        json(res, 400, { error: `${required} must be supplied at most once` })
        return
      }
      const aliasValues = url.searchParams.getAll('aliases')
      if (aliasValues.length > 1 || aliasValues.some(value => value !== '0' && value !== '1')) {
        json(res, 400, { error: 'aliases must be supplied at most once as 0 or 1' })
        return
      }
      const aliases = aliasValues[0] === '1'
      const body = ((): { status: number, body: unknown } => {
        switch (url.pathname) {
          case '/api/overview':
            return { status: 200, body: { db: label, maxSensitivity: maximum, ...overview(store, { maxSensitivity: maximum }) } }
          case '/api/entity': {
            const name = param(url, 'name')
            return name === undefined ?
              { status: 400, body: { error: 'entity requires ?name=' } } :
              { status: 200, body: entity(store, name, { aliases, maxSensitivity: maximum }) }
          }
          case '/api/topic': {
            const name = param(url, 'name')
            return name === undefined ?
              { status: 400, body: { error: 'topic requires ?name=' } } :
              { status: 200, body: topic(store, name, { aliases, maxSensitivity: maximum }) }
          }
          case '/api/history': {
            const key = param(url, 'key')
            if (key === undefined) {
              return { status: 400, body: { error: 'history requires ?key=' } }
            }
            const series = history(store, key, { maxSensitivity: maximum })
            return series.rows.length === 0 ?
              { status: 404, body: { error: `unknown claim key: ${key}` } } :
              { status: 200, body: series }
          }
          case '/api/lineage': {
            const id = param(url, 'id')
            if (id === undefined) {
              return { status: 400, body: { error: 'lineage requires ?id=' } }
            }
            const tree = lineage(store, id, { maxSensitivity: maximum })
            return tree === undefined ?
              { status: 404, body: { error: `unknown row id: ${id}` } } :
              { status: 200, body: tree }
          }
          case '/api/search': {
            const text = param(url, 'q')
            if (text?.includes('\0')) {
              return { status: 400, body: { error: 'search query must not contain NUL characters' } }
            }
            return text === undefined ?
              { status: 400, body: { error: 'search requires ?q=' } } :
              { status: 200, body: search(store, text, { maxSensitivity: maximum }) }
          }
          default:
            return { status: 404, body: { error: `no such endpoint: ${url.pathname}` } }
        }
      })()
      // Node suppresses HEAD bodies; retain the same cache and content headers
      // as GET, including validation errors and unknown endpoints.
      json(res, body.status, body.body)
    } catch (error) {
      json(res, 500, { error: errorMessage(error) })
    }
  }
}

/** Starts the read surface; resolves once the port is bound. */
export const serve = (store: Store, options: ServeOptions = {}): Promise<Handle> => {
  const { port = defaultPort } = options
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('port must be an integer in 0..65535')
  }
  const maximum = maximumSensitivity(options.maxSensitivity)
  const { host = defaultHost } = options
  if (typeof host !== 'string' || host.trim() === '') {
    throw new TypeError('host must be a non-empty string')
  }
  const server = createServer(handler(
    store,
    options.label ?? 'cave.db',
    maximum
  ))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      const address = server.address()
      const boundPort = typeof address === 'object' && address !== null ? address.port : port
      // Bracket IPv6 hosts; the default is IPv4 loopback.
      const shown = host.includes(':') ? `[${host}]` : host
      let closing: Promise<void> | undefined
      resolve({
        url: `http://${shown}:${boundPort}/`,
        server,
        close: () => closing ??= new Promise<void>((done, fail) =>
          server.close(error => error === undefined ? done() : fail(error)))
      })
    })
  })
}
