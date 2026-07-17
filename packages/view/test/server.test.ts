import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { open } from '@cavelang/store'
import { overview, page, serve } from '@cavelang/view'
import type { Handle } from '@cavelang/view'

const fixture = () => {
  const store = open()
  store.ingest(`
api-gateway IS service
api-gateway USES redis-cache @ 90%
platform CONTAINS api-gateway
public-status IS green #sensitivity:public
secret-system USES private-db #sensitivity:confidential
`, { source: 'test' })
  return store
}

const withServer = async (body: (handle: Handle, store: ReturnType<typeof open>) => Promise<void>): Promise<void> => {
  const store = fixture()
  const handle = await serve(store, { port: 0, label: 'test.db' })
  try {
    await body(handle, store)
  } finally {
    await handle.close()
    store.close()
  }
}

test('serves the page at / — self-contained, stamped, CSP-locked (spec §30.1)', () =>
  withServer(async ({ url }) => {
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type')!, /text\/html/)
    const csp = res.headers.get('content-security-policy')!
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /connect-src 'self'/)
    const html = await res.text()
    assert.match(html, /<!doctype html>/)
    assert.ok(html.includes('test.db'), 'the db label is stamped in')
    assert.equal(html.includes('__CAVE_DB__'), false)
    assert.equal(html.includes('__CAVE_VERSION__'), false)
    assert.equal(html.includes('http://'), false, 'no external references')
    assert.equal(html.includes('https://'), false, 'no external references')
  }))

test('the shipped browser renderer HTML-escapes hostile stored text', () => {
  const store = open()
  const hostile = '</span><script>globalThis.pwned=true</script><img src=x onerror=alert(1)>'
  store.ingest(`server IS compromised ; ${hostile}`)
  const row = overview(store).recent[0]!
  store.close()

  const start = page.indexOf('function esc (value)')
  const end = page.indexOf('\nfunction section', start)
  assert.ok(start >= 0 && end > start, 'browser rendering helpers remain present in the shipped page')
  const claimHtml = runInNewContext(
    `var BACKTICK = '\\u0060'\n${page.slice(start, end)}\nclaimHtml`
  ) as (claim: typeof row) => string
  const html = claimHtml(row)

  assert.doesNotMatch(html, /<script|<img/)
  assert.match(html, /&lt;\/span&gt;&lt;script&gt;globalThis\.pwned=true&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('api endpoints answer JSON over the live store (spec §30.2)', () =>
  withServer(async ({ url }) => {
    const data = await (await fetch(`${url}api/overview`)).json() as { db: string, maxSensitivity: string, coverage: { rows: number } }
    assert.equal(data.db, 'test.db')
    assert.equal(data.maxSensitivity, 'internal')
    assert.ok(data.coverage.rows > 0)
    const gateway = await (await fetch(`${url}api/entity?name=api-gateway`)).json() as { out: { verb: string }[], topics: string[] }
    assert.deepEqual(gateway.out.map(fact => fact.verb).sort(), ['IS', 'USES'])
    assert.deepEqual(gateway.topics, ['platform'])
    const platform = await (await fetch(`${url}api/topic?name=platform`)).json() as { members: string[] }
    assert.deepEqual(platform.members, ['api-gateway'])
    const found = await (await fetch(`${url}api/search?q=redis-cache`)).json() as { key: string }[]
    assert.ok(found.length >= 1)
    const series = await (await fetch(`${url}api/history?key=${encodeURIComponent(found[0]!.key)}`)).json() as { rows: unknown[] }
    assert.equal(series.rows.length, 1)
  }))

test('the server applies its sensitivity ceiling to every endpoint (spec §9.7, §30.3)', async () => {
  const store = fixture()
  const hidden = store.currentBeliefs().find(row => row.subject === 'secret-system')!
  const ordinary = await serve(store, { port: 0, label: 'test.db' })
  try {
    assert.deepEqual(await (await fetch(`${ordinary.url}api/search?q=private-db`)).json(), [])
    assert.equal((await fetch(`${ordinary.url}api/history?key=${encodeURIComponent(hidden.claim_key)}`)).status, 404)
    assert.equal((await fetch(`${ordinary.url}api/lineage?id=${hidden.id}`)).status, 404)
  } finally {
    await ordinary.close()
  }
  const wider = await serve(store, { port: 0, maxSensitivity: 'confidential' })
  try {
    const found = await (await fetch(`${wider.url}api/search?q=private-db`)).json() as unknown[]
    assert.equal(found.length, 1)
  } finally {
    await wider.close()
    store.close()
  }
})

test('missing and unknown things answer 400/404, never crash', () =>
  withServer(async ({ url }) => {
    assert.equal((await fetch(`${url}api/entity`)).status, 400)
    assert.equal((await fetch(`${url}api/history?key=nope`)).status, 404)
    assert.equal((await fetch(`${url}api/lineage?id=nope`)).status, 404)
    assert.equal((await fetch(`${url}api/no-such`)).status, 404)
    assert.equal((await fetch(`${url}no-such`)).status, 404)
    const body = await (await fetch(`${url}api/entity`)).json() as { error: string }
    assert.match(body.error, /name/)
  }))

test('the surface is read-only — non-GET methods are refused (spec §30.3)', () =>
  withServer(async ({ url }) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${url}api/overview`, { method })
      assert.equal(res.status, 405)
      assert.equal(res.headers.get('allow'), 'GET, HEAD')
    }
    const head = await fetch(url, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  }))

test('every request reads the live store — later appends show up (spec §30.3)', () =>
  withServer(async ({ url }, store) => {
    const before = await (await fetch(`${url}api/search?q=late-arrival`)).json() as unknown[]
    assert.equal(before.length, 0)
    store.ingest('late-arrival IS recorded', { source: 'test' })
    const after = await (await fetch(`${url}api/search?q=late-arrival`)).json() as unknown[]
    assert.equal(after.length, 1)
  }))
