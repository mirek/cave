import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { request, Server } from 'node:http'
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

test('HTTP rejects corrupted claim keys and transactions and recovers after repair', async () => {
  const store = open()
  store.ingest('broken IS service #sensitivity:restricted')
  const row = store.currentBeliefs()[0]!
  const handle = await serve(store, { port: 0, maxSensitivity: 'restricted' })
  const paths = ['entity?name=broken', `history?key=${encodeURIComponent(row.claim_key)}`,
    `lineage?id=${row.id}`, 'search?q=broken']
  try {
    const before = await Promise.all(paths.map(async path => (await fetch(`${handle.url}api/${path}`)).text()))
    for (const [field, value, message] of [
      ['claim_key', 'wrong-key', /stored claim key/],
      ['tx', '00000000-0000-7000-8000-000000000000', /stored transaction identity/],
      ['tx', row.tx + 'junk', /stored transaction identity/]
    ] as const) {
      store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(value, row.id)
      const snapshot = store.db.prepare('SELECT * FROM cave_claim').all()
      for (const path of paths) {
        // A corrupt key changes the lookup index; request its current value.
        const requested = path.startsWith('history?') && field === 'claim_key' ? 'history?key=wrong-key' : path
        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(`${handle.url}api/${requested}`, { method })
          assert.equal(response.status, 500, `${field}: ${path}`)
          assert.equal(response.headers.get('cache-control'), 'no-store')
          const body = await response.text()
          if (method === 'HEAD') assert.equal(body, '')
          else {
            assert.match(JSON.parse(body).error, message)
            assert.ok(body.includes(row.id))
          }
        }
      }
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim').all(), snapshot)
      store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(row[field], row.id)
      for (const [index, path] of paths.entries()) {
        const response = await fetch(`${handle.url}api/${path}`)
        assert.equal(response.status, 200)
        assert.equal(await response.text(), before[index])
      }
    }
  } finally { await handle.close(); store.close() }
})

test('HTTP rejects malformed stored payloads, flags and numeric caches and recovers after repair', async () => {
  const store = open()
  const id = store.ingest('broken IS service #sensitivity:restricted').ids[0]!
  store.ingest('healthy IS service #sensitivity:public')
  const key = store.currentBeliefs().find(row => row.id === id)!.claim_key
  const handle = await serve(store, { port: 0, maxSensitivity: 'restricted' })
  const publicHandle = await serve(store, { port: 0, maxSensitivity: 'public' })
  try {
    const publicPaths = ['overview', 'topic?name=public-topic', 'search?q=broken', 'entity?name=healthy']
    const publicBodies = new Map<string, string>()
    for (const path of publicPaths) {
      const response = await fetch(`${publicHandle.url}api/${path}`)
      assert.equal(response.status, 200)
      publicBodies.set(path, await response.text())
    }
    for (const [field, value] of [
      ['negated', -1], ['importance', 'false'], ['value_approx', -1], ['value_text', '42'],
      ['value_num', 42], ['value_unit', 'private-value-unit'], ['value_approx', 1],
      ['delta_num', 2], ['delta_unit', 'private-delta-unit']
    ] as const) {
      store.db.prepare(`UPDATE cave_claim SET ${field} = ? WHERE id = ?`).run(value, id)
      const before = JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all())
      for (const path of ['entity?name=broken', `history?key=${encodeURIComponent(key)}`, `lineage?id=${id}`, 'search?q=broken']) {
        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(`${handle.url}api/${path}`, { method })
          assert.equal(response.status, 500, `${field}: ${path}`)
          assert.equal(response.headers.get('cache-control'), 'no-store')
          const body = await response.text()
          if (method === 'HEAD') assert.equal(body, '')
          else {
            assert.match(JSON.parse(body).error, /stored claim.*(payload|negated|importance|value_approx|value_num|value_unit|delta_num|delta_unit)/)
            assert.doesNotMatch(body, /private-value-unit|private-delta-unit/)
          }
        }
      }
      assert.equal((await fetch(`${handle.url}api/search?q=healthy`)).status, 200)
      for (const path of publicPaths) {
        const response = await fetch(`${publicHandle.url}api/${path}`)
        assert.equal(response.status, 200, `${field}: public ${path}`)
        assert.equal(await response.text(), publicBodies.get(path))
      }
      assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()), before)
      store.db.prepare('UPDATE cave_claim SET negated = 0, importance = 0, value_approx = 0, value_text = NULL, value_num = NULL, value_unit = NULL, delta_num = NULL, delta_unit = NULL WHERE id = ?').run(id)
      const recovered = await fetch(`${handle.url}api/entity?name=broken`)
      assert.equal(recovered.status, 200)
    }
  } finally { await publicHandle.close(); await handle.close(); store.close() }
})

test('HTTP rejects binary tag columns without writes and recovers after repair', async () => {
  const store = open()
  const id = store.ingest('broken IS service #label:private-tag #sensitivity:restricted').ids[0]!
  store.ingest('healthy IS service #sensitivity:public')
  const key = store.currentBeliefs().find(row => row.id === id)!.claim_key
  const handle = await serve(store, { port: 0, maxSensitivity: 'restricted' })
  const publicHandle = await serve(store, { port: 0, maxSensitivity: 'public' })
  const paths = ['overview', 'entity?name=broken', `history?key=${encodeURIComponent(key)}`,
    `lineage?id=${id}`, 'search?q=broken']
  const tag = store.db.prepare('SELECT rowid FROM cave_tag WHERE claim_id = ? AND key = ?').get(id, 'label')!
  const tagId = tag.rowid
  assert.ok(typeof tagId === 'number')
  try {
    const before = await Promise.all(paths.map(async path => (await fetch(`${handle.url}api/${path}`)).text()))
    const publicBefore = await (await fetch(`${publicHandle.url}api/overview`)).text()
    for (const field of ['key', 'value'] as const) {
      for (const value of [new Uint8Array(), new TextEncoder().encode('private-tag')]) {
        store.db.prepare(`UPDATE cave_tag SET ${field} = ? WHERE rowid = ?`).run(value, tagId)
        const snapshot = store.db.prepare('SELECT * FROM cave_tag ORDER BY rowid').all()
        for (const path of paths) {
          for (const method of ['GET', 'HEAD']) {
            const response = await fetch(`${handle.url}api/${path}`, { method })
            assert.equal(response.status, 500, `${field}: ${path}`)
            assert.equal(response.headers.get('cache-control'), 'no-store')
            const body = await response.text()
            if (method === 'HEAD') assert.equal(body, '')
            else {
              assert.match(JSON.parse(body).error, /stored tag (key|value) must be/)
              assert.ok(body.includes(id))
              assert.doesNotMatch(body, /private-tag/)
            }
          }
        }
        assert.equal((await fetch(`${handle.url}api/search?q=healthy`)).status, 200)
        const publicResponse = await fetch(`${publicHandle.url}api/overview`)
        assert.equal(publicResponse.status, 200)
        assert.equal(await publicResponse.text(), publicBefore)
        assert.deepEqual(store.db.prepare('SELECT * FROM cave_tag ORDER BY rowid').all(), snapshot)
        store.db.prepare('UPDATE cave_tag SET key = ?, value = ? WHERE rowid = ?').run('label', 'private-tag', tagId)
        for (const [index, path] of paths.entries()) {
          const response = await fetch(`${handle.url}api/${path}`)
          assert.equal(response.status, 200)
          assert.equal(await response.text(), before[index])
        }
      }
    }
  } finally { await publicHandle.close(); await handle.close(); store.close() }
})

test('HTTP contains unprintable store failures and serves subsequent requests', async t => {
  const store = fixture()
  const handle = await serve(store, { port: 0 })
  const listener = handle.server.listeners('request')[0]!
  let escaped: unknown
  // Capture an escaped handler exception so a regression cannot crash the test runner.
  handle.server.removeAllListeners('request')
  handle.server.on('request', (req, res) => {
    try { listener(req, res) } catch (error) {
      escaped = error
      res.writeHead(599)
      res.end()
    }
  })
  const unreadable = new Error('inaccessible message')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message getter failed') } })
  try {
    for (const failure of [Object.create(null), unreadable]) {
      t.mock.method(store.db, 'prepare', () => { throw failure })
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${handle.url}api/overview`, { method })
        assert.equal(escaped, undefined, 'request exception must not escape the HTTP handler')
        assert.equal(response.status, 500)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.equal(await response.text(), method === 'HEAD' ? '' :
          JSON.stringify({ error: '[unprintable thrown value]' }))
      }
      t.mock.restoreAll()
      assert.equal((await fetch(`${handle.url}api/overview`)).status, 200)
    }
  } finally {
    t.mock.restoreAll()
    await handle.close()
    store.close()
  }
})

test('HTTP contains response serialization failures and recovers after adapter repair', async t => {
  const store = fixture()
  const handle = await serve(store, { port: 0, maxSensitivity: 'restricted' })
  const listener = handle.server.listeners('request')[0]!
  let escaped: unknown
  handle.server.removeAllListeners('request')
  handle.server.on('request', (req, res) => {
    try { listener(req, res) } catch (error) {
      escaped = error
      res.destroy()
    }
  })
  try {
    const url = `${handle.url}api/overview`
    const before = await (await fetch(url)).text()
    const prepare = store.db.prepare.bind(store.db)
    t.mock.method(store.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      // BigInt is a SQLite adapter value, but cannot be serialized as JSON.
      return sql === 'SELECT COUNT(*) AS n FROM cave_claim'
        ? { ...statement, get: () => ({ n: 1n }) }
        : statement
    })
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(url, { method }).catch(() => undefined)
      assert.equal(escaped, undefined, 'serialization must not escape the HTTP handler')
      assert.ok(response, 'the client receives an HTTP response')
      assert.equal(response.status, 500)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
      const body = await response.text()
      if (method === 'HEAD') assert.equal(body, '')
      else assert.match(JSON.parse(body).error, /BigInt/i)
    }
    t.mock.restoreAll()
    const repaired = await fetch(url)
    assert.equal(repaired.status, 200)
    assert.equal(await repaired.text(), before)
  } finally {
    t.mock.restoreAll()
    await handle.close()
    store.close()
  }
})

test('browser API errors preserve HTTP status when response bodies are not error objects', async () => {
  let response: Response
  const start = page.indexOf('function api (')
  const end = page.indexOf('function isLiteral', start)
  const api = runInNewContext(`${page.slice(start, end)}\napi`, {
    fetch: async () => response,
    enc: encodeURIComponent,
  }) as (path: string) => Promise<unknown>
  for (const body of ['<html>Unavailable</html>', 'null', '[]', '{"error":{"detail":"bad"}}']) {
    response = new Response(body, { status: 503 })
    await assert.rejects(api('overview'), /HTTP 503/)
  }
  response = new Response('{"error":"Known API failure"}', { status: 400 })
  await assert.rejects(api('overview'), /Known API failure/)
  response = new Response('not JSON', { status: 200 })
  await assert.rejects(api('overview'), /Could not read JSON response.*HTTP 200/)
  response = new Response('{"healthy":true}')
  assert.equal((await api('overview') as { healthy: boolean }).healthy, true)
})

test('serve rejects invalid sensitivity ceilings and permits a corrected start', async () => {
  const store = fixture()
  try {
    for (const value of ['', 'PUBLIC', 'unknown', 1, false, {}]) {
      let handle: Handle | undefined
      try {
        const options = Object.defineProperty({ port: 0 }, 'maxSensitivity', { value })
        await assert.rejects(Promise.resolve().then(async () => { handle = await serve(store, options) }),
          error => error instanceof TypeError && /maxSensitivity/.test(error.message))
      } finally { if (handle !== undefined) await handle.close() }
    }
    const handle = await serve(store, { port: 0, maxSensitivity: 'public' })
    try {
      const response = await fetch(`${handle.url}api/overview`)
      assert.equal(response.status, 200)
      const text = await response.text()
      assert.match(text, /public-status/)
      assert.doesNotMatch(text, /secret-system/)
    } finally { await handle.close() }
  } finally { store.close() }
})

test('serve rejects null startup settings before binding and permits corrected startup', async t => {
  const store = fixture()
  try {
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const listen = t.mock.method(Server.prototype, 'listen', () => { throw new Error('unexpected listener creation') })
    for (const name of ['port', 'host', 'maxSensitivity']) {
      const options = Object.defineProperty({ port: 0 }, name, { value: null })
      await assert.rejects(Promise.resolve().then(() => serve(store, options)), new RegExp(`${name} must be`))
    }
    assert.equal(listen.mock.callCount(), 0)
    listen.mock.restore()
    const handle = await serve(store, { port: 0, host: '127.0.0.1', maxSensitivity: 'public' })
    try {
      const response = await fetch(`${handle.url}api/overview`)
      assert.equal(response.status, 200)
      assert.equal((await response.json() as { maxSensitivity: string }).maxSensitivity, 'public')
    } finally { await handle.close() }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { t.mock.restoreAll(); store.close() }
})

test('serve rejects invalid port types and ranges before a corrected start', async () => {
  const store = fixture()
  try {
    for (const value of ['0', false, -1, 65536, 1.5, NaN, Infinity]) {
      let handle: Handle | undefined
      try {
        const options = Object.defineProperty({}, 'port', { value })
        await assert.rejects(Promise.resolve().then(async () => { handle = await serve(store, options) }),
          error => error instanceof TypeError && error.message === 'port must be an integer in 0..65535')
      } finally { if (handle !== undefined) await handle.close() }
    }
    const handle = await serve(store, { port: 0 })
    try {
      assert.ok(Number(new URL(handle.url).port) > 0)
      const response = await fetch(`${handle.url}api/overview`)
      assert.equal(response.status, 200)
      await response.text()
    } finally { await handle.close() }
  } finally { store.close() }
})

test('serve rejects empty or non-string hosts before invoking listen', async t => {
  const store = fixture()
  let listens = 0
  try {
    t.mock.method(Server.prototype, 'listen', () => {
      listens++
      throw new Error('unexpected listener creation')
    })
    try {
      for (const value of ['', '   ', false, 1, {}]) {
        const options = Object.defineProperty({ port: 0 }, 'host', { value })
        await assert.rejects(Promise.resolve().then(() => serve(store, options)),
          error => error instanceof TypeError && error.message === 'host must be a non-empty string')
      }
      assert.equal(listens, 0)
    } finally { t.mock.restoreAll() }
    const handle = await serve(store, { port: 0, host: '127.0.0.1' })
    try {
      assert.equal(new URL(handle.url).hostname, '127.0.0.1')
      const response = await fetch(`${handle.url}api/overview`)
      assert.equal(response.status, 200)
      await response.text()
    } finally { await handle.close() }
  } finally { t.mock.restoreAll(); store.close() }
})

test('viewer shutdown is shared by concurrent callers and remains safe to repeat', async () => {
  const store = fixture()
  const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
  const handle = await serve(store, { port: 0 })
  try {
    assert.equal(handle.server.listenerCount('error'), 0, 'startup rejection listener is released after binding')
    const failures: unknown[] = []
    const runtimeError = (error: unknown): void => { failures.push(error) }
    handle.server.on('error', runtimeError)
    const first = new Error('first runtime event'), second = new Error('second runtime event')
    handle.server.emit('error', first)
    handle.server.emit('error', second)
    assert.deepEqual(failures, [first, second])
    await Promise.all([handle.close(), handle.close()])
    assert.equal(handle.server.listening, false)
    await handle.close()
    assert.deepEqual(handle.server.listeners('error'), [runtimeError], 'HTTP close preserves caller-owned listeners')
    handle.server.removeListener('error', runtimeError)
    assert.equal(handle.server.listenerCount('error'), 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally {
    if (handle.server.listening) await handle.close()
    store.close()
  }
})

test('an occupied viewer port rejects without affecting either store and permits retry', async () => {
  const first = fixture(), second = fixture()
  const before = second.exportText({ tx: true, maxSensitivity: 'restricted' })
  let original: Handle | undefined
  let retried: Handle | undefined
  try {
    original = await serve(first, { port: 0, label: 'original' })
    const port = Number(new URL(original.url).port)
    await assert.rejects(serve(second, { port, label: 'retry' }),
      error => error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE')
    assert.equal(second.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    const response = await fetch(`${original.url}api/overview`)
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { db: string }).db, 'original')
    await original.close()
    original = undefined
    retried = await serve(second, { port, label: 'retry' })
    const recovered = await fetch(`${retried.url}api/overview`)
    assert.equal(recovered.status, 200)
    assert.equal((await recovered.json() as { db: string }).db, 'retry')
    assert.equal(second.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally {
    if (retried !== undefined) await retried.close()
    if (original !== undefined) await original.close()
    first.close()
    second.close()
  }
})

test('page labels remain literal across replacement metacharacters and template markers', async () => {
  const store = open()
  const label = "$& $$ $` $' <img> __CAVE_DB__ __CAVE_VERSION__ __CAVE_SENSITIVITY__"
  const expected = '$&amp; $$ $` $&#39; &lt;img&gt; __CAVE_DB__ __CAVE_VERSION__ __CAVE_SENSITIVITY__'
  const handle = await serve(store, { port: 0, label })
  try {
    const html = await (await fetch(handle.url)).text()
    assert.ok(html.includes(expected), html.slice(0, 300))
    assert.equal(html.split('<script>').length - 1, 1)
    assert.equal(html.includes('<img>'), false)
    const overview = await (await fetch(`${handle.url}api/overview`)).json() as { db: string }
    assert.equal(overview.db, label)
  } finally { await handle.close(); store.close() }
})

test('browser search waits for input composition to finish before handling Enter', () => {
  type Key = { key: string, isComposing?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }
  let keydown!: (event: Key & { preventDefault: () => void }) => void
  let refreshed = 0, prevented = 0
  const press = (event: Key) => keydown({ ...event, preventDefault: () => { prevented++ } })
  const search = { value: 'api & cache', addEventListener: (_name: string, listener: typeof keydown) => { keydown = listener } }
  const aliases = { checked: false, addEventListener: () => undefined }
  const location = { hash: '#/' }
  const start = page.indexOf('<script>') + '<script>'.length
  const end = page.indexOf('function esc', start)
  runInNewContext(page.slice(start, end), {
    document: { querySelector: () => ({ addEventListener: () => undefined }), getElementById: (name: string) => name === 'q' ? search : name === 'aliases' ? aliases : {} },
    localStorage: { getItem: () => null }, location, route: () => { refreshed++ }
  })
  press({ key: 'Enter', isComposing: true })
  assert.equal(location.hash, '#/')
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    press({ key: 'Enter', [modifier]: true })
    assert.equal(location.hash, '#/')
  }
  assert.equal(prevented, 0)
  press({ key: 'Enter', isComposing: false })
  assert.equal(location.hash, '#/s/api%20%26%20cache')
  assert.equal(refreshed, 0)
  press({ key: 'Enter', isComposing: true })
  assert.equal(refreshed, 0)
  press({ key: 'Enter', isComposing: false })
  assert.equal(refreshed, 1)
  search.value = '   '
  press({ key: 'Enter' })
  assert.equal(location.hash, '#/s/api%20%26%20cache')
  assert.equal(refreshed, 1)
  assert.equal(prevented, 2)
})

test('browser alias preferences remain usable when storage access is denied', () => {
  const listeners = new Map<string, () => void>()
  const aliases = { checked: false, addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) }
  const search = { addEventListener: () => undefined }
  let routed = 0
  let reads = 0
  let writes = 0
  const context = {
    document: { querySelector: () => ({ addEventListener: () => undefined }), getElementById: (name: string) => name === 'aliases' ? aliases : name === 'q' ? search : {} },
    route: () => { routed++ },
    localStorage: {
      getItem: () => { reads++; throw new Error('storage denied') },
      setItem: () => { writes++; throw new Error('storage denied') }
    }
  }
  const start = page.indexOf('<script>') + '<script>'.length
  const end = page.indexOf('function esc', start)
  assert.ok(end > start)
  assert.doesNotThrow(() => runInNewContext(page.slice(start, end), context))
  assert.equal(aliases.checked, false)
  aliases.checked = true
  assert.doesNotThrow(() => listeners.get('change')!())
  assert.equal(aliases.checked, true)
  assert.equal(routed, 1)
  assert.equal(reads, 1)
  assert.equal(writes, 1)
})

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

test('browser navigation ignores stale results and errors and recovers from malformed fragments', async () => {
  const requests: { resolve(value: string): void, reject(error: Error): void }[] = []
  const attributes = new Map<string, string>()
  let retry: (() => void) | undefined
  const view = {
    innerHTML: '', contains: () => false,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    querySelector: (selector: string): object => {
      if (selector === 'h1') return { textContent: view.innerHTML }
      assert.equal(selector, '.retry')
      return { addEventListener: (name: string, listener: () => void) => {
        assert.equal(name, 'click')
        retry = listener
      } }
    },
  }
  const loadingStatus = { textContent: '' }
  const document = { activeElement: null, title: 'cave — test' }
  const location = { hash: '#/e/first' }
  const render = (data: string) => { view.innerHTML = data }
  const start = page.indexOf('var navigation = 0')
  const end = page.indexOf("window.addEventListener('hashchange', route)", start)
  assert.ok(start >= 0 && end > start)
  const route = runInNewContext(`${page.slice(start, end)}\nroute`, {
    view, loadingStatus, location, baseTitle: document.title, document, aliasBox: { checked: false }, searchBox: { value: '' },
    esc: (value: string) => value.replaceAll('<', '&lt;'),
    api: () => new Promise<string>((resolve, reject) => requests.push({ resolve, reject })),
    entityPage: render, topicPage: render, historyPage: render,
    lineagePage: render, dashboard: render, searchPage: (_text: string, data: string) => render(data)
  }) as () => void
  const settle = async () => { await Promise.resolve(); await Promise.resolve() }

  route()
  assert.equal(attributes.get('aria-busy'), 'true')
  assert.equal(loadingStatus.textContent, 'Loading view.')
  assert.match(page, /id="loading-status"[^>]*role="status"/)
  location.hash = '#/t/latest'
  route()
  requests[0]!.resolve('stale entity')
  await settle()
  assert.equal(attributes.get('aria-busy'), 'true')
  assert.equal(loadingStatus.textContent, 'Loading view.')
  assert.match(view.innerHTML, /loading/)
  requests[1]!.resolve('latest topic')
  await settle()
  assert.equal(view.innerHTML, 'latest topic')
  assert.equal(document.title, 'latest topic — cave — test')
  assert.equal(attributes.get('aria-busy'), 'false')
  assert.equal(loadingStatus.textContent, 'View loaded.')

  location.hash = '#/s/older-search'
  route()
  location.hash = '#/k/latest-history'
  route()
  requests[3]!.resolve('latest history')
  await settle()
  requests[2]!.reject(new Error('stale failure'))
  await settle()
  assert.equal(view.innerHTML, 'latest history')
  assert.equal(document.title, 'latest history — cave — test')

  location.hash = '#/l/older-lineage'
  route()
  location.hash = '#/e/%E0%A4%A'
  assert.doesNotThrow(route)
  assert.match(view.innerHTML, /class="err"/)
  assert.match(view.innerHTML, /role="alert"/)
  assert.equal(attributes.get('aria-busy'), 'false')
  assert.equal(loadingStatus.textContent, '')
  const malformed = view.innerHTML
  requests[4]!.resolve('stale lineage')
  await settle()
  assert.equal(view.innerHTML, malformed)
  assert.equal(document.title, 'View error — cave — test')

  location.hash = '#/'
  route()
  requests[5]!.resolve('recovered dashboard')
  await settle()
  assert.equal(view.innerHTML, 'recovered dashboard')
  assert.equal(attributes.get('aria-busy'), 'false')
  route()
  requests[6]!.reject(new Error('<current failure>'))
  await settle()
  assert.match(view.innerHTML, /&lt;current failure>/)
  assert.ok(retry)
  retry()
  assert.equal(location.hash, '#/')
  requests[7]!.resolve('retried dashboard')
  await settle()
  assert.equal(view.innerHTML, 'retried dashboard')
  assert.equal(attributes.get('aria-busy'), 'false')
})

test('the server applies its sensitivity ceiling to every endpoint (spec §9.7, §30.3)', async () => {
  const store = fixture()
  store.ingest('secret-topic CONTAINS secret-system #sensitivity:confidential')
  const hidden = store.currentBeliefs().find(row => row.subject === 'secret-system')!
  const ordinary = await serve(store, { port: 0, label: 'test.db' })
  try {
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const override = 'maxSensitivity=restricted&max-sensitivity=restricted&aliases=1'
    const summary = await (await fetch(`${ordinary.url}api/overview?${override}`)).json() as {
      maxSensitivity: string, coverage: { rows: number }, topics: { name: string }[]
    }
    assert.equal(summary.maxSensitivity, 'internal')
    assert.equal(summary.coverage.rows, overview(store).coverage.rows)
    assert.equal(summary.topics.some(item => item.name === 'secret-topic'), false)
    const hiddenEntity = await (await fetch(`${ordinary.url}api/entity?name=secret-system&${override}`)).json() as {
      facts: unknown[], out: unknown[], in: unknown[], activity: unknown[], total: number
    }
    for (const section of ['facts', 'out', 'in', 'activity'] as const) assert.deepEqual(hiddenEntity[section], [])
    assert.equal(hiddenEntity.total, 0)
    assert.deepEqual(await (await fetch(`${ordinary.url}api/topic?name=secret-topic&${override}`)).json(),
      { name: 'secret-topic', members: [] })
    assert.deepEqual(await (await fetch(`${ordinary.url}api/search?q=private-db&${override}`)).json(), [])
    for (const path of [`api/history?key=${encodeURIComponent(hidden.claim_key)}`, `api/lineage?id=${hidden.id}`]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${ordinary.url}${path}&${override}`, { method })
        assert.equal(response.status, 404)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        if (method === 'HEAD') assert.equal(await response.text(), '')
        else await response.text()
      }
    }
    assert.deepEqual(await (await fetch(`${ordinary.url}api/search?q=private-db`)).json(), [])
    assert.equal((await fetch(`${ordinary.url}api/history?key=${encodeURIComponent(hidden.claim_key)}`)).status, 404)
    assert.equal((await fetch(`${ordinary.url}api/lineage?id=${hidden.id}`)).status, 404)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally {
    await ordinary.close()
  }
  const wider = await serve(store, { port: 0, maxSensitivity: 'confidential' })
  try {
    const found = await (await fetch(`${wider.url}api/search?q=private-db`)).json() as unknown[]
    assert.equal(found.length, 1)
    const membership = await (await fetch(`${wider.url}api/topic?name=secret-topic`)).json()
    assert.deepEqual(membership, { name: 'secret-topic', members: ['secret-system'] })
  } finally {
    await wider.close()
    store.close()
  }
})

test('HTTP alias settings reject invalid or repeated values and recover without writes', () =>
  withServer(async ({ url }, store) => {
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const query of ['aliases=', 'aliases=true', 'aliases=false', 'aliases=2', 'aliases=01', 'aliases=1&aliases=0', 'aliases=1&aliases=1']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${url}api/entity?name=api-gateway&${query}`, { method })
        assert.equal(response.status, 400, `${method} ${query}`)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        if (method === 'HEAD') assert.equal(await response.text(), '')
        else assert.match((await response.json() as { error: string }).error, /aliases/)
      }
    }
    for (const suffix of ['', '&aliases=0', '&aliases=1']) {
      const response = await fetch(`${url}api/entity?name=api-gateway${suffix}`)
      assert.equal(response.status, 200)
      await response.json()
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  }))

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

test('malformed request URLs answer 400 and leave the server usable', () =>
  withServer(async ({ url }, store) => {
    store.ingest('bad���name IS marker\ncafé😀 IS marker')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const malformed = ['%ED%A0%80', '%ED%B0%80', '%C0%AF', '%FF', '%', '%GG']
    for (const path of ['//[', 'http://[', ...malformed.map(value => `/api/search?q=bad${value}name`)]) {
      for (const method of ['GET', 'HEAD']) {
        const result = await new Promise<{ status: number | undefined, cache: string | undefined, body: string }>((resolve, reject) => {
          const req = request(url, { path, method }, res => {
            let body = ''
            res.setEncoding('utf8')
            res.on('data', chunk => { body += chunk })
            res.on('error', reject)
            res.on('end', () => resolve({ status: res.statusCode, cache: res.headers['cache-control'], body }))
          })
          req.on('error', reject)
          req.end()
        })
        assert.equal(result.status, 400, `${method} ${path}`)
        assert.equal(result.cache, 'no-store')
        assert.equal(result.body, method === 'HEAD' ? '' : JSON.stringify({ error: 'invalid request URL' }))
      }
    }
    for (const name of ['bad���name', 'café😀']) {
      const valid = await fetch(`${url}api/search?q=${encodeURIComponent(name)}&extra=%25FF`)
      assert.equal(valid.status, 200)
      assert.ok((await valid.text()).includes(name))
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal((await fetch(`${url}api/overview`)).status, 200)
  }))

test('the surface is read-only — non-GET methods are refused (spec §30.3)', () =>
  withServer(async ({ url }) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${url}api/overview`, { method })
      assert.equal(res.status, 405)
      assert.equal(res.headers.get('allow'), 'GET, HEAD')
      assert.equal(res.headers.get('cache-control'), 'no-store')
    }
    const head = await fetch(url, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  }))

test('HEAD preserves GET status and cache protection without a response body', () =>
  withServer(async ({ url }) => {
    for (const path of ['', 'api/overview', 'api/entity', 'api/entity?name=api-gateway', 'api/no-such', 'no-such']) {
      const get = await fetch(`${url}${path}`)
      await get.text()
      const head = await fetch(`${url}${path}`, { method: 'HEAD' })
      assert.equal(head.status, get.status, path)
      for (const header of ['content-type', 'cache-control', 'x-content-type-options', 'content-security-policy']) {
        assert.equal(head.headers.get(header), get.headers.get(header), `${path}: ${header}`)
      }
      assert.equal(head.headers.get('cache-control'), 'no-store', path)
      assert.equal(await head.text(), '', path)
    }
  }))

test('every request reads the live store — later appends show up (spec §30.3)', () =>
  withServer(async ({ url }, store) => {
    const before = await (await fetch(`${url}api/search?q=late-arrival`)).json() as unknown[]
    assert.equal(before.length, 0)
    store.ingest('late-arrival IS recorded', { source: 'test' })
    const after = await (await fetch(`${url}api/search?q=late-arrival`)).json() as unknown[]
    assert.equal(after.length, 1)
  }))

test('an interrupted response leaves the server usable and HTTP close preserves store ownership', { timeout: 10_000 }, async () => {
  const store = fixture()
  const label = 'x'.repeat(2 * 1024 * 1024)
  let sourceClosed = 0
  store.onClose(() => { sourceClosed++ })
  const handle = await serve(store, { port: 0, label })
  try {
    const interrupted = await new Promise<{ bytes: number, complete: boolean }>((resolve, reject) => {
      const req = request(`${handle.url}api/overview`, res => {
        let bytes = 0
        res.once('data', (chunk: Buffer) => {
          bytes += chunk.length
          res.destroy()
        })
        res.on('error', error => { if (bytes === 0) reject(error) })
        res.once('close', () => resolve({ bytes, complete: res.complete }))
      })
      req.setTimeout(2_000, () => req.destroy(new Error('response did not arrive')))
      req.on('error', reject)
      req.end()
    })
    assert.ok(interrupted.bytes > 0 && interrupted.bytes < label.length)
    assert.equal(interrupted.complete, false, 'the client stopped before receiving the whole response')
    const response = await fetch(`${handle.url}api/entity?name=api-gateway`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /api-gateway/)
    await handle.close()
    assert.equal(sourceClosed, 0, 'HTTP handle does not own the supplied store')
    store.ingest('after-http-close IS available')
    assert.ok(store.currentBeliefs().some(row => row.subject === 'after-http-close'))
  } finally {
    if (handle.server.listening) await handle.close()
    store.close()
  }
  assert.equal(sourceClosed, 1)
})

test('search rejects NUL query text as a client error and remains usable', () =>
  withServer(async ({ url }) => {
    for (const method of ['GET', 'HEAD']) {
      const result = await fetch(`${url}api/search?q=api%00ignored`, { method })
      assert.equal(result.status, 400)
      assert.equal(result.headers.get('cache-control'), 'no-store')
      assert.equal(result.headers.get('content-type'), 'application/json; charset=utf-8')
      assert.equal(await result.text(), method === 'HEAD' ? '' : JSON.stringify({ error: 'search query must not contain NUL characters' }))
    }
    const valid = await fetch(`${url}api/search?q=api`)
    assert.equal(valid.status, 200)
    assert.match(await valid.text(), /api-gateway/)
  }))

test('history rendering distinguishes visible revisions from retracted series', async () => {
  const store = open()
  store.ingest('history-marker HAS state: visible #sensitivity:public')
  const key = store.currentBeliefs()[0]!.claim_key
  store.ingest('history-marker HAS state: hidden #sensitivity:restricted')
  const handle = await serve(store, { port: 0, maxSensitivity: 'public' })
  const start = page.indexOf('function historyPage (data)')
  const end = page.indexOf('\nfunction treeHtml', start)
  const view = { innerHTML: '' }
  const render = runInNewContext(`${page.slice(start, end)}\nhistoryPage`, {
    view, esc: (value: string) => value, claimList: () => ''
  }) as (data: unknown) => void
  try {
    for (const conf of [1, 0, 0.5]) {
      if (conf !== 1) store.ingest(`history-marker HAS state: visible @ ${conf * 100}% #sensitivity:public`)
      const response = await fetch(`${handle.url}api/history?${new URLSearchParams({ key })}`)
      assert.equal(response.status, 200)
      const body = await response.text()
      assert.doesNotMatch(body, /hidden/)
      const data = JSON.parse(body) as { rows: { conf: number }[] }
      assert.equal(data.rows.at(-1)!.conf, conf)
      render(data)
      assert.match(view.innerHTML, /last row is the latest visible event/)
      assert.doesNotMatch(view.innerHTML, /last row is current belief/)
      assert.equal(view.innerHTML.includes('This series is retracted in the selected audience.'), conf === 0)
    }
  } finally { await handle.close(); store.close() }
})

test('viewer confidence labels do not round positive beliefs to retraction or certainty', () => {
  const start = page.indexOf('function esc (value)')
  const end = page.indexOf('\nfunction section', start)
  const render = runInNewContext(
    `var BACKTICK = '\\u0060'\n${page.slice(start, end)}\nclaimHtml`
  ) as (claim: Record<string, unknown>, options?: Record<string, unknown>) => string
  const claim = { subject: 'sensor', verb: 'EXISTS', contexts: [], tags: [],
    key: 'fixture', id: 'fixture', at: '2026-09-08T00:00:00.000Z', cites: 0, citedBy: 0 }
  for (const [conf, expected] of [
    [Number.MIN_VALUE, '&lt;0.1%'], [0.00001, '&lt;0.1%'],
    [0.001, '0.1%'], [0.999, '99.9%'], [0.99999, '&gt;99.9%']
  ] as const) {
    const html = render({ ...claim, conf }, { bar: true })
    assert.ok(html.includes(`@ ${expected}</span>`), html)
    assert.ok(html.includes(`title="confidence ${expected}"`), html)
    assert.doesNotMatch(html, /class="conf retracted"/)
  }
  assert.match(render({ ...claim, conf: 0 }), /class="conf retracted" title="retracted">@ 0%/)
  assert.doesNotMatch(render({ ...claim, conf: 1 }), /class="conf"/)
})

test('HTTP required parameters reject duplicates and accept corrected requests', () =>
  withServer(async ({ url }, store) => {
    const row = store.currentBeliefs()[0]!
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const [endpoint, parameter, value] of [
      ['entity', 'name', 'api-gateway'], ['topic', 'name', 'platform'],
      ['history', 'key', row.claim_key], ['lineage', 'id', row.id], ['search', 'q', 'api']
    ]) {
      const original = new URLSearchParams([[parameter!, value!]])
      for (const second of [value!, 'different']) {
        const repeated = new URLSearchParams(original)
        repeated.append(parameter!, second)
        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(`${url}api/${endpoint}?${repeated}`, { method })
          assert.equal(response.status, 400, `${method} ${endpoint}`)
          assert.equal(response.headers.get('cache-control'), 'no-store')
          if (method === 'HEAD') assert.equal(await response.text(), '')
          else assert.match((await response.json() as { error: string }).error, /must be supplied at most once/)
        }
      }
      const corrected = await fetch(`${url}api/${endpoint}?${original}`)
      assert.equal(corrected.status, 200, endpoint)
      await corrected.json()
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  }))

test('HTTP search retains historical revisions and retractions in newest-first order', () =>
  withServer(async ({ url }, store) => {
    store.ingest('revision-marker HAS state: legacy')
    store.ingest('revision-marker HAS state: modern')
    store.ingest('revision-marker HAS state: modern @ 0%')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const response = await fetch(`${url}api/search?q=revision-marker`)
    assert.equal(response.status, 200)
    const results = await response.json() as { id: string, key: string, value: string, conf: number }[]
    assert.deepEqual(results.map(row => [row.value, row.conf]), [['modern', 0], ['modern', 1], ['legacy', 1]])
    assert.equal(new Set(results.map(row => row.id)).size, 3)
    assert.equal(new Set(results.map(row => row.key)).size, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  }))

test('HTTP search treats FTS operators and punctuation as literal query text', () =>
  withServer(async ({ url }, store) => {
    store.ingest('phrase HAS note: "api OR cache"')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const query of ['api OR cache', '"', '(', '*', 'NEAR(api cache)']) {
      const response = await fetch(`${url}api/search?${new URLSearchParams({ q: query })}`)
      assert.equal(response.status, 200, query)
      const matches = await response.json() as { subject: string }[]
      assert.deepEqual(matches.map(match => match.subject), query === 'api OR cache' ? ['phrase'] : [])
    }
    const corrected = await fetch(`${url}api/search?q=api`)
    assert.equal(corrected.status, 200)
    assert.match(await corrected.text(), /api-gateway/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  }))

test('viewer search exposes the HTTP result cap without claiming all matches were returned', () =>
  withServer(async ({ url }, store) => {
    store.ingest(Array.from({ length: 101 }, (_, i) => `item-${i} HAS note: "cap-marker"`).join('\n'))
    const response = await fetch(`${url}api/search?q=cap-marker`)
    assert.equal(response.status, 200)
    const matches = await response.json() as { subject: string }[]
    assert.equal(matches.length, 100)
    assert.equal(matches[0]!.subject, 'item-100')
    assert.equal(matches.at(-1)!.subject, 'item-1')
    const start = page.indexOf('function searchPage (text, data)')
    const end = page.indexOf('\nvar navigation', start)
    const view = { innerHTML: '' }
    const render = runInNewContext(`${page.slice(start, end)}\nsearchPage`, {
      view, esc: (text: string) => text, claimList: () => '', section: () => ''
    }) as (text: string, data: unknown[]) => void
    render('cap-marker', matches)
    assert.match(view.innerHTML, /Showing the newest 100 matches\. More may exist/)
    render('fewer', matches.slice(0, 99))
    assert.doesNotMatch(view.innerHTML, /More may exist/)
    assert.match(view.innerHTML, /Search includes earlier revisions and retracted claims, newest first/)
    assert.match(view.innerHTML, /Open a claim’s history to follow its changes/)
    render('empty', [])
    assert.match(view.innerHTML, /Search includes earlier revisions and retracted claims/)
    assert.doesNotMatch(view.innerHTML, /More may exist/)
    assert.ok(page.includes('aria-label="Search claims by phrase"'))
  }))
