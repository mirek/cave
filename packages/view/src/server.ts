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

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { Version } from '@cavelang/core'
import type { Store } from '@cavelang/store'
import { entity, history, lineage, overview, search, topic } from './api.ts'
import { page } from './page.ts'

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

/** A required query parameter, `undefined` when absent or blank. */
const param = (url: URL, name: string): undefined | string => {
  const value = url.searchParams.get(name)
  return value === null || value === '' ? undefined : value
}

const handler = (store: Store, label: string) => {
  const html = page
    .replaceAll('__CAVE_DB__', escapeHtml(label))
    .replaceAll('__CAVE_VERSION__', escapeHtml(Version.current()))
  return (req: IncomingMessage, res: ServerResponse): void => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8' })
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'read-only surface — GET only (spec §30.3)' }))
        return
      }
      const url = new URL(req.url ?? '/', 'http://cave.local')
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
      const aliases = url.searchParams.get('aliases') === '1'
      const body = ((): { status: number, body: unknown } => {
        switch (url.pathname) {
          case '/api/overview':
            return { status: 200, body: { db: label, ...overview(store) } }
          case '/api/entity': {
            const name = param(url, 'name')
            return name === undefined ?
              { status: 400, body: { error: 'entity requires ?name=' } } :
              { status: 200, body: entity(store, name, { aliases }) }
          }
          case '/api/topic': {
            const name = param(url, 'name')
            return name === undefined ?
              { status: 400, body: { error: 'topic requires ?name=' } } :
              { status: 200, body: topic(store, name, { aliases }) }
          }
          case '/api/history': {
            const key = param(url, 'key')
            if (key === undefined) {
              return { status: 400, body: { error: 'history requires ?key=' } }
            }
            const series = history(store, key)
            return series.rows.length === 0 ?
              { status: 404, body: { error: `unknown claim key: ${key}` } } :
              { status: 200, body: series }
          }
          case '/api/lineage': {
            const id = param(url, 'id')
            if (id === undefined) {
              return { status: 400, body: { error: 'lineage requires ?id=' } }
            }
            const tree = lineage(store, id)
            return tree === undefined ?
              { status: 404, body: { error: `unknown row id: ${id}` } } :
              { status: 200, body: tree }
          }
          case '/api/search': {
            const text = param(url, 'q')
            return text === undefined ?
              { status: 400, body: { error: 'search requires ?q=' } } :
              { status: 200, body: search(store, text) }
          }
          default:
            return { status: 404, body: { error: `no such endpoint: ${url.pathname}` } }
        }
      })()
      if (head) {
        res.writeHead(body.status, { 'content-type': 'application/json; charset=utf-8' })
        res.end()
        return
      }
      json(res, body.status, body.body)
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Starts the read surface; resolves once the port is bound. */
export const serve = (store: Store, options: ServeOptions = {}): Promise<Handle> => {
  const host = options.host ?? defaultHost
  const server = createServer(handler(store, options.label ?? 'cave.db'))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? defaultPort, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : options.port ?? defaultPort
      // Bracket IPv6 hosts; the default is IPv4 loopback.
      const shown = host.includes(':') ? `[${host}]` : host
      resolve({
        url: `http://${shown}:${port}/`,
        server,
        close: () => new Promise<void>((done, fail) =>
          server.close(error => error === undefined ? done() : fail(error)))
      })
    })
  })
}
