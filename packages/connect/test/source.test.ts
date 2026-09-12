import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Source } from '@cavelang/connect'

test('quoted large JSON identifiers remain distinct through loading and SQL projection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-json-identifiers-'))
  const expected = [
    { id: '9007199254740992', amount: '0.1234567890123456789', count: 2 },
    { id: '9007199254740993', amount: '0.1234567890123456788', count: 3 }
  ]
  try {
    for (const format of ['json', 'jsonl'] as const) {
      const text = format === 'json' ? JSON.stringify(expected) : expected.map(record => JSON.stringify(record)).join('\n')
      const path = join(dir, `records.${format}`)
      writeFileSync(path, text)
      for (const options of [{}, { sql: 'SELECT id, amount, count FROM records ORDER BY id' }]) {
        assert.deepEqual(Source.loadSync(path, options).records, expected)
        assert.deepEqual((await Source.load(path, options)).records, expected)
        assert.deepEqual((await Source.load(`https://example.test/records.${format}`, {
          ...options, fetchImpl: async () => new Response(text)
        })).records, expected)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('local and fetched text sources reject invalid UTF-8 without replacing record data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-utf8-'))
  try {
    for (const [format, prefix, suffix] of [
      ['csv', 'name\nbad', '\n'],
      ['tsv', 'name\nbad', '\n'],
      ['json', '[{"name":"bad', '"}]'],
      ['jsonl', '{"name":"bad', '"}\n'],
    ] as const) {
      const path = join(dir, `records.${format}`)
      const url = `https://example.test/records.${format}`
      for (const invalid of [[0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0x98]]) {
        const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from(invalid), Buffer.from(suffix)])
        writeFileSync(path, bytes)
        assert.throws(() => Source.loadSync(path), /invalid UTF-8/)
        await assert.rejects(Source.load(url, { fetchImpl: async () => new Response(bytes) }), /invalid UTF-8/)
      }
      const valid = `${prefix}�café 😀${suffix}`
      writeFileSync(path, valid)
      const expected = [{ name: 'bad�café 😀' }]
      assert.deepEqual(Source.loadSync(path).records, expected)
      assert.deepEqual((await Source.load(url, { fetchImpl: async () => new Response(valid) })).records, expected)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('parseCsv rejects unfinished quoted fields instead of accepting truncated records', () => {
  for (const text of ['"id', 'id,name\n1,"unfinished', 'id,name\r\n1,"two\r\nlines', 'id,name\n1,"escaped ""']) {
    assert.throws(() => Source.parseCsv(text), /unterminated quoted field/i)
  }
})

test('CSV rejects stray quotes and text after a quoted field at the physical line', () => {
  assert.throws(() => Source.parseCsv('name\nun"quoted'), /CSV line 2: unexpected quote in unquoted field/)
  assert.throws(() => Source.parseCsv('name\n"value"suffix'), /CSV line 2: unexpected character after closing quote/)
  assert.throws(() => Source.parseCsv('name\r\n"two\r\nlines" trailing'), /CSV line 3: unexpected character after closing quote/)
  assert.deepEqual(Source.parseCsv('name\r\n"a ""quoted"" value"\r\n'), [{ name: 'a "quoted" value' }])
})

test('CSV rejects duplicate normalized headers before columns can be overwritten', () => {
  for (const header of ['id,id', 'id, id ', '"id",id', ',']) {
    for (const data of ['', '\nfirst,second']) {
      assert.throws(() => Source.parseCsv(header + data), /CSV line 1: duplicate column name/)
    }
  }
  assert.deepEqual(Source.parseCsv('id,ID\nfirst,second'), [{ id: 'first', ID: 'second' }])
})

test('CSV rejects excess cells without changing missing-cell defaults or quoted delimiters', () => {
  assert.throws(() => Source.parseCsv('id,name\n1,alice,discarded'), /CSV line 2: 3 cells exceed 2 header columns/)
  assert.throws(() => Source.parseCsv('id,name\r\n"two\r\nlines",alice,discarded'), /CSV line 2: 3 cells exceed 2 header columns/)
  assert.deepEqual(Source.parseCsv('id,name\n1\n2,"alice,bob"'), [{ id: '1', name: '' }, { id: '2', name: 'alice,bob' }])
})

test('quoted empty CSV records survive blank-line filtering and SQL staging', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-empty-field-'))
  const path = join(dir, 'records.csv')
  try {
    for (const ending of ['', '\n', '\r\n']) {
      const text = `name\r\n\r\n""\r\n\r\n""${ending}`
      writeFileSync(path, text)
      assert.deepEqual(Source.parseCsv(text), [{ name: '' }, { name: '' }])
      assert.deepEqual(Source.loadSync(path).spans, [
        { startLine: 3, endLine: 3 }, { startLine: 5, endLine: 5 }
      ])
      assert.deepEqual(Source.loadSync(path, { sql: 'SELECT COUNT(*) AS total FROM records' }).records, [{ total: 2 }])
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('parseCsv handles quotes, escaped quotes, embedded delimiters and newlines (RFC 4180)', () => {
  const records = Source.parseCsv([
    'id,name,notes',
    '1,"Liddell, Alice","she said ""hi"""',
    '2,Bob,"two',
    'lines"',
    ''
  ].join('\r\n'))
  assert.deepEqual(records, [
    { id: '1', name: 'Liddell, Alice', notes: 'she said "hi"' },
    { id: '2', name: 'Bob', notes: 'two\nlines' }
  ])
})

test('parseCsv: BOM stripped, missing cells default to empty, custom delimiter', () => {
  const records = Source.parseCsv('﻿a\tb\n1\t2\n3', '\t')
  assert.deepEqual(records, [{ a: '1', b: '2' }, { a: '3', b: '' }])
})

test('CSV delimiter validation applies to empty and populated sources', () => {
  for (const delimiter of ['', '||', '"', '\r', '\n']) {
    for (const text of ['', 'id,name\n1,alice']) {
      assert.throws(() => Source.parseCsv(text, delimiter), /CSV delimiter must be a single character other than a double quote or line break/)
    }
  }
  for (const delimiter of [';', '|', '\t']) {
    assert.deepEqual(Source.parseCsv(`id${delimiter}name\n1${delimiter}alice`, delimiter), [{ id: '1', name: 'alice' }])
  }
})

test('CSV delimiters reject nonstring settings without coercion', async () => {
  let conversions = 0
  const coercible = { length: 1, toString() { conversions++; return ',' } }
  for (const value of [null, false, 1, 1n, Symbol('delimiter'), [','], new String(','), coercible]) {
    const delimiter = value as unknown as string
    for (const text of ['', 'id,name\n1,alice']) {
      assert.throws(() => Source.parseCsv(text, delimiter), /CSV delimiter must be/)
      for (const format of ['csv', 'tsv'] as const) {
        await assert.rejects(Source.load('https://example.test/data', {
          format, delimiter, fetchImpl: async () => new Response(text)
        }), /CSV delimiter must be/)
      }
    }
  }
  assert.equal(conversions, 0)
  assert.deepEqual(Source.parseCsv('id;name\n1;alice', ';'), [{ id: '1', name: 'alice' }])
})

test('loaded CSV records retain inclusive physical line spans', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'people.csv')
  writeFileSync(path, 'id,notes\n1,one\n2,"two\nlines"\n')
  const loaded = await Source.load(path)
  assert.deepEqual(loaded.spans, [
    { startLine: 2, endLine: 2 },
    { startLine: 3, endLine: 4 }
  ])
})

test('json sources need an array of records; --records picks it by dot path', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'data.json')
  writeFileSync(path, JSON.stringify({ data: { items: [{ id: 1 }, { id: 2 }] } }))
  await assert.rejects(Source.load(path), /--records/)
  const { records } = await Source.load(path, { records: 'data.items' })
  assert.deepEqual(records, [{ id: 1 }, { id: 2 }])
})

test('JSON record selectors preserve own prototype-like and dotted keys on local and HTTP sources', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-selector-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'source.json')
  const text = '{"__proto__":[{"id":"own"}],"constructor":[{"id":"own"}],"data.items":[{"id":"exact"}],"data":{"items":[{"id":"nested"}]}}'
  writeFileSync(path, text)
  for (const source of [path, 'https://example.test/source.json']) {
    for (const records of ['__proto__', 'constructor', 'data.items']) {
      const loaded = await Source.load(source, { records, fetchImpl: async () => new Response(text) })
      assert.deepEqual(loaded.records, [{ id: records === 'data.items' ? 'exact' : 'own' }])
    }
    for (const records of ['toString', 'data.__proto__', 'constructor.map']) {
      await assert.rejects(Source.load(source, { records, fetchImpl: async () => new Response(text) }), /--records .* not found/)
    }
  }
})

test('jsonl sources parse one object per non-blank line', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'events.jsonl')
  writeFileSync(path, '{"id":1}\n\n{"id":2}\n')
  const { records, format, spans } = await Source.load(path)
  assert.equal(format, 'jsonl')
  assert.deepEqual(records, [{ id: 1 }, { id: 2 }])
  assert.deepEqual(spans, [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3 }])
})

test('JSONL syntax errors identify the source and physical line for local and HTTP inputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-jsonl-error-'))
  const path = join(dir, 'records.jsonl')
  const text = '\r\n{"id":1}\r\n\r\n{"id":}\r\n'
  const check = (source: string) => (error: unknown): boolean => {
    assert.ok(error instanceof Error)
    assert.ok(error.message.startsWith(`${source}: line 4: invalid JSON — `), error.message)
    assert.ok(error.cause instanceof SyntaxError)
    return true
  }
  try {
    writeFileSync(path, text)
    assert.throws(() => Source.loadSync(path), check(path))
    const url = 'https://x.example/records.jsonl'
    await assert.rejects(Source.load(url, {
      fetchImpl: async () => new Response(text, { headers: { 'content-type': 'application/x-ndjson' } })
    }), check(url))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('sqlite sources preserve 64-bit integers as exact text outside the safe number range', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-integers-'))
  const path = join(dir, 'source.sqlite')
  const db = new DatabaseSync(path)
  try {
    db.exec('CREATE TABLE records (small INTEGER, big INTEGER, negative INTEGER, fraction REAL)')
    db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(42, 9223372036854775807n, -9223372036854775808n, 1.5)
  } finally { db.close() }
  try {
    const expected = [{ small: 42, big: '9223372036854775807', negative: '-9223372036854775808', fraction: 1.5 }]
    assert.deepEqual(Source.loadSync(path, { table: 'records' }).records, expected)
    assert.deepEqual((await Source.load(path, { sql: 'SELECT * FROM records' })).records, expected)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('sqlite sources read a table or a query, read-only (spec §23)', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'crm.sqlite')
  const db = new DatabaseSync(path)
  db.exec("CREATE TABLE people (id INTEGER, name TEXT); INSERT INTO people VALUES (1, 'Alice'), (2, 'Bob')")
  db.close()
  const byTable = await Source.load(path, { table: 'people' })
  assert.deepEqual(byTable.records, [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])
  const bySql = await Source.load(path, { sql: 'SELECT name FROM people WHERE id = 2' })
  assert.deepEqual(bySql.records, [{ name: 'Bob' }])
  await assert.rejects(Source.load(path), /--table or --sql/)
  await assert.rejects(Source.load(path, { table: 'people', sql: 'SELECT 1' }), /--table or --sql/)
})

test('isUrl recognizes http(s) sources case-insensitively', () => {
  assert.ok(Source.isUrl('https://x.example/items.json'))
  assert.ok(Source.isUrl('HTTPS://X.EXAMPLE/ITEMS.JSON'))
  assert.ok(Source.isUrl('Http://localhost:8080/'))
  assert.ok(!Source.isUrl('people.csv'))
  assert.ok(!Source.isUrl('https.md'))
  assert.ok(!Source.isUrl('file:///etc/hosts'))
})

test('URL sources reject malformed Unicode before fetch and retain valid paths', async () => {
  const calls: string[] = []
  const fetchImpl: Source.FetchLike = async url => { calls.push(url); return new Response('[{"id":1}]') }
  for (const surrogate of ['\ud800', '\udc00']) {
    await assert.rejects(Source.load(`https://x.example/${surrogate}.json`, { fetchImpl }), /URL must contain well-formed Unicode/)
  }
  assert.deepEqual(calls, [])
  const url = 'https://x.example/café-😀.json'
  assert.deepEqual((await Source.load(url, { fetchImpl })).records, [{ id: 1 }])
  assert.deepEqual(calls, [url])
})

test('URL source timeouts accept whole-millisecond decimals and reject invalid settings before fetch', async () => {
  let calls = 0
  const fetchImpl: Source.FetchLike = async () => { calls++; return new Response('[{"id":1}]') }
  assert.deepEqual((await Source.load('https://x.example/items.json', { fetchImpl, timeoutSeconds: 1.001 })).records, [{ id: 1 }])
  for (const timeoutSeconds of [NaN, Infinity, -1, 0.0001, 1.0001, 2147483.648]) {
    await assert.rejects(Source.load('https://x.example/items.json', { fetchImpl, timeoutSeconds }), /timeoutSeconds must resolve to whole milliseconds/)
  }
  assert.equal(calls, 1)
})

test('URL source timeouts reject nonnumeric values without coercion or fetching', async () => {
  let calls = 0
  let conversions = 0
  const fetchImpl: Source.FetchLike = async () => { calls++; return new Response('[{"id":1}]') }
  const url = 'https://x.example/items.json'
  const coercible = { valueOf() { conversions++; return 1 } }
  for (const value of [null, '1', true, false, 1n, Symbol('timeout'), [], {}, new Number(1), coercible]) {
    const options = { fetchImpl, timeoutSeconds: value as unknown as number }
    await assert.rejects(Source.load(url, options), /timeoutSeconds must resolve to whole milliseconds/)
    await assert.rejects(Source.fetchText(url, options), /timeoutSeconds must resolve to whole milliseconds/)
  }
  assert.equal(calls, 0)
  assert.equal(conversions, 0)
  assert.deepEqual((await Source.load(url, { fetchImpl, timeoutSeconds: 1.001 })).records, [{ id: 1 }])
  assert.equal(calls, 1)
})

test('URL record loading retains parsing settings across awaited fetch callbacks', async () => {
  const options: Source.Options = {
    format: 'json', records: 'items',
    fetchImpl: async () => {
      await Promise.resolve()
      Object.assign(options, { format: 'csv', records: 'missing', sql: 'SELECT missing FROM records' })
      return new Response('{"items":[{"id":1}]}')
    }
  }
  assert.deepEqual((await Source.load('https://x.example/items', options)).records, [{ id: 1 }])
})

test('direct source fetching retains cancellation after caller settings change', async () => {
  const controller = new AbortController()
  const reason = new Error('cancel captured source fetch')
  const options: Source.Options = {
    signal: controller.signal,
    fetchImpl: async () => {
      await Promise.resolve()
      Object.assign(options, { signal: undefined })
      controller.abort(reason)
      return new Response('[]')
    }
  }
  await assert.rejects(Source.fetchText('https://x.example/items.json', options), error => error === reason)
})

test('url sources fetch with headers and a timeout signal, format from content-type', async () => {
  const calls: { url: string, init: RequestInit }[] = []
  const fetchImpl: Source.FetchLike = async (url, init) => {
    calls.push({ url, init })
    return new Response('[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const { records, format } = await Source.load('HTTPS://x.example/api/items', { fetchImpl })
  assert.equal(format, 'json', 'extensionless URLs infer the format from content-type')
  assert.deepEqual(records, [{ id: 1 }])
  const { init } = calls[0]!
  assert.ok(init.signal instanceof AbortSignal, 'the request carries a timeout signal')
  assert.equal(init.redirect, 'follow')
  const headers = init.headers as Record<string, string>
  assert.equal(headers['user-agent'], 'cave-connect')
  assert.match(headers.accept ?? '', /json/)

  const failing: Source.FetchLike = async () => new Response('nope', { status: 500 })
  await assert.rejects(Source.load('https://x.example/api/items', { fetchImpl: failing }), /HTTP 500/)
})

test('HTTP JSONL content types use the record-per-line reader and retain source spans', async () => {
  for (const contentType of ['application/x-ndjson', 'application/jsonl', 'Application/X-NDJSON; charset=utf-8']) {
    const fetchImpl: Source.FetchLike = async () => new Response('{"id":1}\n\n{"id":2}\n', {
      headers: { 'content-type': contentType }
    })
    const loaded = await Source.load('https://x.example/records', { fetchImpl })
    assert.equal(loaded.format, 'jsonl')
    assert.deepEqual(loaded.records, [{ id: 1 }, { id: 2 }])
    assert.deepEqual(loaded.spans, [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3 }])
    const projected = await Source.load('https://x.example/records', { fetchImpl, sql: 'SELECT id FROM records WHERE id = 2' })
    assert.deepEqual(projected.records, [{ id: 2 }])
    assert.equal(projected.spans, undefined)
  }
  const explicit = await Source.load('https://x.example/records', {
    format: 'json', fetchImpl: async () => new Response('[{"id":3}]', { headers: { 'content-type': 'application/x-ndjson' } })
  })
  assert.equal(explicit.format, 'json')
  assert.deepEqual(explicit.records, [{ id: 3 }])
})

test('HTTP TSV content types preserve columns and spans on extensionless endpoints', async () => {
  let contentType = 'text/tab-separated-values'
  let body = 'id\tname\r\n001\t"Alice\r\nExample"\r\n002\tBob\r\n'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': contentType })
    response.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}/records`
  try {
    for (const header of ['text/tab-separated-values', 'Text/Tab-Separated-Values; charset=utf-8']) {
      contentType = header
      const loaded = await Source.load(url)
      assert.equal(loaded.format, 'tsv')
      assert.deepEqual(loaded.columns, ['id', 'name'])
      assert.deepEqual(loaded.records, [{ id: '001', name: 'Alice\nExample' }, { id: '002', name: 'Bob' }])
      assert.deepEqual(loaded.spans, [{ startLine: 2, endLine: 3 }, { startLine: 4, endLine: 4 }])
      const projected = await Source.load(url, { sql: "SELECT id FROM records WHERE name = 'Bob'" })
      assert.deepEqual(projected.records, [{ id: '002' }])
      assert.equal(projected.spans, undefined)
    }
    body = '[{"id":3}]'
    const explicit = await Source.load(url, { format: 'json' })
    assert.equal(explicit.format, 'json')
    assert.deepEqual(explicit.records, [{ id: 3 }])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('HTTP failures cancel unread response bodies without hiding the status error', async () => {
  for (const failCancellation of [false, true]) {
    let cancellations = 0
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations++
        if (failCancellation) throw new Error('cleanup failed')
      }
    })
    await assert.rejects(Source.fetchText('https://x.example/records.json', {
      fetchImpl: async () => new Response(body, { status: 503 })
    }), /https:\/\/x\.example\/records\.json: HTTP 503/)
    assert.equal(cancellations, 1)
  }
})

test('url sources time out instead of hanging on a stalled endpoint', async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('[{"id":1}]')
    }, 2000).unref()
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const { port } = server.address() as AddressInfo
  try {
    await assert.rejects(
      Source.load(`http://127.0.0.1:${port}/slow.json`, { timeoutSeconds: 0.1 }),
      (error: unknown) => error instanceof Error && /timeout|abort/i.test(error.name)
    )
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('source formats reject invalid explicit values before file or network access', async () => {
  let calls = 0
  const fetchImpl: Source.FetchLike = async () => { calls++; return new Response('[{"id":1}]') }
  for (const value of ['xml', '', 'JSON', null, false, 0, [], {}, Symbol('format')]) {
    const options = { format: value as Source.Format, fetchImpl }
    assert.throws(() => Source.formatOf('missing.json', options), /format must be/)
    assert.throws(() => Source.loadSync('missing.json', options), /format must be/)
    await assert.rejects(Source.load('missing.json', options), /format must be/)
    await assert.rejects(Source.load('https://example.test/data', options), /format must be/)
  }
  assert.equal(calls, 0)
  for (const format of Source.formats) assert.equal(Source.formatOf('data.unknown', { format }), format)
  assert.deepEqual((await Source.load('https://example.test/data', { format: 'json', fetchImpl })).records, [{ id: 1 }])
  assert.equal(calls, 1)
})

test('formatOf infers from extension, nameOf names the source (spec §23.2)', () => {
  assert.equal(Source.formatOf('data.csv'), 'csv')
  assert.equal(Source.formatOf('data.ndjson'), 'jsonl')
  assert.equal(Source.formatOf('crm.db'), 'sqlite')
  assert.equal(Source.formatOf('https://x.example/api/items.json'), 'json')
  assert.throws(() => Source.formatOf('data.xml'), /--format/)
  assert.equal(Source.formatOf('data.xml', { format: 'json' }), 'json')
  assert.equal(Source.nameOf('/tmp/dir/people.csv'), 'people')
  assert.equal(Source.nameOf('https://x.example/exports/people v2.json'), 'people-v2')
})

test('SQL sources reject statements without result columns before executing them', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-sql-statements-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'source.db')
  const copy = join(dir, 'copy.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (1)')
  db.close()
  const sql = `VACUUM INTO '${copy.replaceAll("'", "''")}'`
  assert.throws(() => Source.loadSync(path, { sql }), /SQL source query must return columns/)
  assert.equal(existsSync(copy), false, 'rejected source SQL must not create a database copy')
  assert.throws(() => Source.queryRecords([{ id: 1 }], sql), /SQL source query must return columns/)
  assert.equal(existsSync(copy), false)
  for (const statement of ['DELETE FROM records', 'UPDATE records SET id = 2']) {
    assert.throws(() => Source.queryRecords([{ id: 1 }], statement), /SQL source query must return columns/)
  }
  assert.deepEqual(Source.loadSync(path, { table: 'records' }).records, [{ id: 1 }])
  assert.deepEqual(Source.loadSync(path, { sql: 'SELECT id FROM records WHERE 0' }).records, [])
  assert.deepEqual(Source.queryRecords([{ id: 1 }], 'SELECT id FROM records WHERE 0'), [])
})

test('SQL result names must be unique before rows become record objects', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-sql-columns-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'source.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (1)')
  db.close()
  for (const sql of [
    'SELECT id, 2 AS id FROM records',
    'SELECT a.*, b.* FROM records a JOIN records b',
    'SELECT id, 2 AS id FROM records WHERE 0',
    'SELECT id AS "", 2 AS "" FROM records'
  ]) {
    assert.throws(() => Source.queryRecords([{ id: 1 }], sql), /duplicate SQL result column/)
    assert.throws(() => Source.queryRecords([], sql, 'records', ['id']), /duplicate SQL result column/)
    assert.throws(() => Source.loadSync(path, { sql }), /duplicate SQL result column/)
  }
  const sql = 'SELECT id, 2 AS ID, 3 AS "__proto__" FROM records'
  const expected = [JSON.parse('{"id":1,"ID":2,"__proto__":3}')]
  assert.deepEqual(Source.queryRecords([{ id: 1 }], sql), expected)
  assert.deepEqual(Source.loadSync(path, { sql }).records, expected)
})

test('SQL staging rejects non-finite fields before SQLite or JSON can turn them into NULL', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const field of [value, { nested: value }, [value]]) {
      assert.throws(() => Source.queryRecords([{ field }], 'SELECT field FROM records'), /non-finite numeric field cannot be staged/)
    }
  }
  assert.deepEqual(Source.queryRecords([{ field: null }, { field: { nested: 1.5 } }], 'SELECT field FROM records'), [
    { field: null }, { field: '{"nested":1.5}' }
  ])
})

test('SQL staging uses NULL for absent fields named like prototype properties', () => {
  const records = JSON.parse('[{"id":1},{"id":2,"toString":"text","constructor":"builder","__proto__":"data"}]')
  assert.deepEqual(Source.queryRecords(records, 'SELECT * FROM records ORDER BY id'), [
    { id: 1, toString: null, constructor: null, ['__proto__']: null },
    { id: 2, toString: 'text', constructor: 'builder', ['__proto__']: 'data' }
  ])
})

test('--sql reshapes text-format records through a temporary SQLite table (spec §23.1)', () => {
  const records = [
    { id: 1, name: 'ann', active: true, address: { city: 'Oslo' } },
    { id: 2, name: 'bob', active: false, address: { city: 'Riga' } },
    { id: 3, name: 'cy', tags: ['x', 'y'] }
  ]
  const rows = Source.queryRecords(records, "SELECT upper(name) AS shout, json_extract(address, '$.city') AS city, active FROM records WHERE id < 3 ORDER BY id")
  assert.deepEqual(rows, [{ shout: 'ANN', city: 'Oslo', active: 1 }, { shout: 'BOB', city: 'Riga', active: 0 }])
  assert.deepEqual(Source.queryRecords([{ id: '00123' }, { id: '123' }], 'SELECT id, typeof(id) AS t FROM records ORDER BY rowid'),
    [{ id: '00123', t: 'text' }, { id: '123', t: 'text' }], 'text stays text — identifiers keep their zeros')
  assert.deepEqual(Source.queryRecords([], 'SELECT id, name FROM records', 'records', ['id', 'name']), [], 'a header-only source still has its columns')
  assert.deepEqual(Source.queryRecords([{}, {}], 'SELECT count(*) AS n FROM records'), [{ n: 2 }], 'field-less records are still rows')
  assert.deepEqual(Source.queryRecords([], 'SELECT id, name FROM records WHERE CAST(id AS INTEGER) > 1 ORDER BY records.name'), [], 'a schemaless source that became empty still answers the columns its query names')
  assert.deepEqual(Source.queryRecords([], 'SELECT r.id, "name", `tag`, [note] FROM records AS r WHERE r.id IS NOT NULL'), [], 'qualified and quoted references resolve to their column')
  assert.deepEqual(Source.queryRecords([], 'SELECT "first.name", r."last.name" FROM records AS r'), [], 'a quoted identifier keeps its dots')
  assert.deepEqual(Source.queryRecords([], 'SELECT r.id, "r.id" FROM records AS r'), [], 'a qualified name and a quoted dotted column coexist')
  assert.throws(() => Source.queryRecords([{ id: 1 }], 'SELECT nope FROM records'), /no such column/, 'with records present a missing column is the mistake it is')
  assert.throws(() => Source.queryRecords([], 'SELECT nmae FROM records', 'records', ['id', 'name']), /no such column: nmae/, 'a header-bearing source keeps its validation even when empty')
  assert.deepEqual(Source.queryRecords([], 'SELECT id FROM records', 'records', []), [], 'a CSV cleared to nothing has no header: an empty schema infers like no schema')
  assert.deepEqual(Source.queryRecords([], 'SELECT r.id, s.name FROM records r JOIN records s USING(id, "first.name")'), [], 'a column named only in JOIN … USING is staged from its own diagnostic')
  assert.deepEqual(Source.queryRecords([], 'SELECT "x - should this be y", `y - should this be a string literal in single-quotes?`, "a""b" FROM records'), [], "SQLite's hint is stripped exactly and only after a quoted name")
  assert.deepEqual(Source.queryRecords([], 'SELECT * FROM records r JOIN records s USING("x - column not present in both tables")'), [], 'a USING column keeps its own suffix-like text')
  assert.deepEqual(Source.queryRecords([], 'SELECT ` first ` AS a, [ last ] AS b, " both " AS c, r.` first ` AS d FROM records r'), [], 'edge spaces in a delimited name are part of the field')
  assert.deepEqual(Source.queryRecords([], 'SELECT `[id]` AS a, "`id`" AS b, `"x"` AS c, r."[y]" AS d FROM records r'), [], 'brackets and backticks SQLite already stripped are part of the field; a quoted name is staged both ways')
  assert.deepEqual(Source.queryRecords([], 'SELECT r."first\nname" AS name FROM records r JOIN records s USING("a\nb")'), [], 'a name spanning lines is inferred whole')
  assert.deepEqual(Source.queryRecords([], 'SELECT "" AS value FROM records'), [], 'the empty name is a column SQLite accepts, so it is staged too')
  assert.deepEqual(Source.queryRecords([{ id: 9223372036854775808n, neg: -9223372036854775809n }], 'SELECT id, typeof(id) AS t, neg FROM records'),
    [{ id: '9223372036854775808', t: 'text', neg: '-9223372036854775809' }], 'a bigint beyond SQLite\'s 64-bit integer binds as its exact decimal text')
  const wide = Array.from({ length: 100 }, (_, at) => `c${at}`)
  assert.deepEqual(Source.queryRecords([], `SELECT ${wide.join(', ')} FROM records WHERE ${wide.map(name => `${name} IS NULL`).join(' AND ')}`), [], 'inference is not capped: every column a wide query names is staged')
  assert.deepEqual(Source.queryRecords([{ id: '9007199254740993' }], 'SELECT CAST(id AS INTEGER) AS big, CAST(id AS INTEGER) + 0 AS same FROM records'),
    [{ big: '9007199254740993', same: '9007199254740993' }], 'an integer beyond the safe range comes back as exact text, not an error')
  assert.deepEqual(Source.queryRecords([{ id: 9007199254740993n }], 'SELECT id FROM records'), [{ id: '9007199254740993' }], 'a bigint field is bound exactly')
  assert.deepEqual(Source.queryRecords([{ id: '2' }], 'SELECT id FROM records', 'records', ['id', 'id']), [{ id: '2' }], 'a repeated header is one column')
  assert.throws(() => Source.queryRecords([{ id: 1, ID: 2 }], 'SELECT id FROM records'), /fields "id" and "ID" differ only in case/, 'SQLite cannot tell them apart, and merging would lose data')
  assert.deepEqual(Source.queryRecords([{ 'Ä': 1, 'ä': 2 }], 'SELECT "Ä" AS upper, "ä" AS lower FROM records'), [{ upper: 1, lower: 2 }], 'SQLite folds ASCII only, so non-ASCII case pairs are distinct columns')
  assert.deepEqual(Source.queryRecords(records, 'SELECT count(*) AS n FROM people', 'people'), [{ n: 3 }], 'the table can be named')
  assert.throws(() => Source.queryRecords(records, 'SELECT 1', 'bad name'), /not a plain identifier/)
  assert.deepEqual(Source.queryRecords([], 'SELECT count(*) AS n FROM records'), [{ n: 0 }], 'no records is an empty table')
  const dir = mkdtempSync(join(tmpdir(), 'cave-source-'))
  try {
    writeFileSync(join(dir, 'people.csv'), 'id,name\n1,ann\n2,bob\n')
    const loaded = Source.loadSync(join(dir, 'people.csv'), { sql: "SELECT name || '-' || id AS slug FROM records WHERE CAST(id AS INTEGER) = 2" })
    assert.deepEqual(loaded.records, [{ slug: 'bob-2' }])
    assert.equal(loaded.spans, undefined, 'line spans do not survive a query')
    writeFileSync(join(dir, 'dup.csv'), 'id,id\n1,2\n')
    assert.throws(() => Source.loadSync(join(dir, 'dup.csv'), { sql: 'SELECT id FROM records' }), /duplicate column name "id"/, 'SQL staging must not hide overwritten source cells')
    writeFileSync(join(dir, 'empty.csv'), ' id , name \n')
    assert.deepEqual(Source.loadSync(join(dir, 'empty.csv'), { sql: 'SELECT id, name FROM records' }).records, [], 'the header survives an empty file, trimmed as record keys are')
    writeFileSync(join(dir, 'cleared.csv'), '')
    assert.deepEqual(Source.loadSync(join(dir, 'cleared.csv'), { sql: 'SELECT id, name FROM records' }).records, [], 'a file cleared to nothing still answers the columns its query names')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('empty-source inference preserves unreadable SQL errors without retrying', t => {
  const sql = 'SELECT id FROM records'
  for (const diagnostic of [42, Object.create(null), undefined]) {
    const failure = new Error('unreadable SQL error')
    Object.defineProperty(failure, 'message', diagnostic === undefined
      ? { get() { throw new Error('message unavailable') } }
      : { value: diagnostic })
    const prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close
    let attempts = 0, closes = 0
    try {
      t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, text: string) {
        if (text === sql) { attempts++; throw failure }
        return prepare.call(this, text)
      })
      t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) { close.call(this); closes++ })
      assert.throws(() => Source.queryRecords([], sql), error => error === failure)
      assert.equal(attempts, 1)
      assert.equal(closes, 1)
    } finally { t.mock.restoreAll() }
    assert.deepEqual(Source.queryRecords([], sql), [])
  }
})

for (const mode of ['sqlite', 'staged', 'empty-staged'] as const) test(`${mode} preserves SQL and database-close failures`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-source-close-'))
  const path = join(dir, 'source.db')
  const source = new DatabaseSync(path)
  source.exec('CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (1)')
  source.close()
  const sql = 'SELECT id FROM records'
  const failure = new Error(mode === 'empty-staged' ? 'no such column: id' : 'source query failed')
  const closeFailure = new Error('source close failed')
  const prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close
  let closes = 0
  const perform = () => mode === 'sqlite' ? Source.loadSync(path, { sql }).records :
    Source.queryRecords(mode === 'staged' ? [{ id: 1 }] : [], sql)
  try {
    t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, text: string) {
      if (text === sql) throw failure
      return prepare.call(this, text)
    })
    t.mock.method(DatabaseSync.prototype, 'close', function (this: DatabaseSync) {
      close.call(this)
      closes++
      throw closeFailure
    })
    assert.throws(perform, error => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.cause, failure)
      assert.deepEqual(error.errors, [failure, closeFailure])
      return true
    })
    assert.equal(closes, 1)
    t.mock.restoreAll()
    assert.deepEqual(perform(), mode === 'empty-staged' ? [] : [{ id: 1 }])
    assert.deepEqual(Source.loadSync(path, { sql }).records, [{ id: 1 }])
  } finally { t.mock.restoreAll(); rmSync(dir, { recursive: true, force: true }) }
})


test('a stalled HTTP body times out, releases its connection and permits a fresh load', { timeout: 5000 }, async t => {
  let requests = 0
  let resolveClosed!: () => void
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    if (requests === 1) {
      response.on('close', resolveClosed)
      response.write('[{"id":')
    } else {
      response.end('[{"id":2,"name":"recovered"}]')
    }
  })
  t.after(() => { server.closeAllConnections(); server.close() })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}/records.json`
  await assert.rejects(Source.load(url, { timeoutSeconds: 0.5 }),
    (error: unknown) => error instanceof Error && /timeout|abort/i.test(error.name))
  await closed
  assert.equal(requests, 1)
  const recovered = await Source.load(url, { timeoutSeconds: 2 })
  assert.deepEqual(recovered.records, [{ id: 2, name: 'recovered' }])
  assert.equal(recovered.format, 'json')
  assert.equal(requests, 2)
})

test('JSON syntax errors identify local and HTTP sources and permit corrected retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-json-error-'))
  const path = join(dir, 'records.json')
  const url = 'https://example.test/records.json'
  const check = (source: string) => (error: unknown): boolean => {
    assert.ok(error instanceof SyntaxError)
    assert.ok(error.message.startsWith(`${source}: invalid JSON — `), error.message)
    assert.ok(error.cause instanceof SyntaxError)
    assert.ok(error.message.endsWith(error.cause.message))
    return true
  }
  try {
    writeFileSync(path, '[{"id":')
    assert.throws(() => Source.loadSync(path), check(path))
    await assert.rejects(Source.load(path), check(path))
    await assert.rejects(Source.load(url, { fetchImpl: async () => new Response('[{"id":') }), check(url))
    writeFileSync(path, '[{"id":1}]')
    assert.deepEqual(Source.loadSync(path).records, [{ id: 1 }])
    assert.deepEqual((await Source.load(url, { fetchImpl: async () => new Response('[{"id":1}]') })).records, [{ id: 1 }])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

for (const phase of ['fetch', 'body'] as const) for (const unprintable of [false, true]) test(`source cancellation retains simultaneous ${phase} failures (unprintable=${unprintable})`, async () => {
  const controller = new AbortController(), reason = new Error('cancel source')
  const failure = new Error('transport failed independently')
  if (unprintable) {
    Object.defineProperty(reason, 'message', { value: Object.create(null) })
    Object.defineProperty(failure, 'message', { get() { throw new Error('message unavailable') } })
  }
  const fail = async (): Promise<never> => { controller.abort(reason); throw failure }
  await assert.rejects(Source.fetchText('https://example.test/records.json', {
    signal: controller.signal,
    fetchImpl: phase === 'fetch' ? fail : async () => {
      const response = new Response('[]')
      Object.defineProperty(response, 'arrayBuffer', { value: fail })
      return response
    }
  }), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [reason, failure])
    assert.equal(error.cause, reason)
    if (unprintable) assert.equal(error.message, '[unprintable thrown value]; source fetch also failed: [unprintable thrown value]')
    else assert.match(error.message, /cancel source.*transport failed independently/)
    return true
  })
})

for (const field of ['cause', 'errors']) for (const unreadable of [false, true]) test(`source cancellation inspects ${field} once (unreadable=${unreadable})`, async () => {
  const controller = new AbortController(), reason = new Error('cancel source')
  const failure = field === 'cause' ? new Error('transport failed') : new AggregateError([], 'transport failed')
  let reads = 0
  Object.defineProperty(failure, field, { get() {
    reads++
    if (unreadable) throw new Error('cause unavailable')
    return field === 'errors' ? [reason] : reads === 1 ? reason : undefined
  } })
  await assert.rejects(Source.fetchText('https://example.test/records', {
    signal: controller.signal,
    fetchImpl: async () => { controller.abort(reason); throw failure }
  }), error => {
    if (!unreadable) assert.equal(error, failure)
    else {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors[0], reason)
      assert.equal(error.errors[1], failure)
      assert.equal(error.cause, reason)
    }
    assert.equal(reads, 1)
    return true
  })
})

test('source cancellation preserves errors already containing its reason', async () => {
  for (const wrapped of [false, true]) {
    const controller = new AbortController(), reason = new Error('cancel source')
    const failure = wrapped ? new Error('fetch and cleanup failed', {
      cause: new AggregateError([new Error('cleanup detail'), reason])
    }) : reason
    await assert.rejects(Source.fetchText('https://example.test/records.json', {
      signal: controller.signal,
      fetchImpl: async () => { controller.abort(reason); throw failure }
    }), error => error === failure)
  }
})

test('selected JSON arrays reject an invalid later record and recover without partial results', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-record-shape-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'source.json')
  const options = { records: 'data.items' }
  for (const invalid of [null, 3, false, 'record', [], [{ id: 'nested' }]]) {
    const text = JSON.stringify({ data: { items: [{ id: 'first' }, invalid] } })
    writeFileSync(path, text)
    assert.throws(() => Source.loadSync(path, options), /record 2 is not an object/)
    await assert.rejects(Source.load(path, options), /record 2 is not an object/)
    await assert.rejects(Source.load('https://example.test/source.json', {
      ...options, fetchImpl: async () => new Response(text),
    }), /record 2 is not an object/)
  }
  for (const records of [[], [{ id: 'first' }, { id: 'recovered' }]]) {
    const text = JSON.stringify({ data: { items: records } })
    writeFileSync(path, text)
    assert.deepEqual(Source.loadSync(path, options).records, records)
    assert.deepEqual((await Source.load(path, options)).records, records)
    assert.deepEqual((await Source.load('https://example.test/source.json', {
      ...options, fetchImpl: async () => new Response(text),
    })).records, records)
  }
})

test('SQL projection rejects malformed record batches and accepts corrected input', () => {
  for (const records of [[42], [false], ['text'], [[]], [null], new Array(1), null, {}]) {
    assert.throws(() => Source.queryRecords(records as unknown as readonly Record<string, unknown>[], 'SELECT count(*) AS n FROM records'),
      /records must be an array|record \d+ must be an object/)
  }
  assert.deepEqual(Source.queryRecords([{}, {}], 'SELECT count(*) AS n FROM records'), [{ n: 2 }])
  assert.deepEqual(Source.queryRecords([], 'SELECT count(*) AS n FROM records'), [{ n: 0 }])
})


test('SQL projection rejects malformed schemas and accepts corrected headers', () => {
  for (const schema of ['id', null, {}, new Set(['id']), [42], [null], new Array(1),
    new Proxy(['id'], { get(target, key, receiver) { return key === 'length' ? NaN : Reflect.get(target, key, receiver) } })]) {
    assert.throws(() => Source.queryRecords([], 'SELECT count(*) AS n FROM records', 'records', schema as unknown as readonly string[]),
      /schema must be a dense array of strings/)
  }
  assert.deepEqual(Source.queryRecords([], 'SELECT id FROM records', 'records', ['id']), [])
  assert.deepEqual(Source.queryRecords([], 'SELECT id FROM records', 'records', []), [])
})

test('SQL projection captures schema once so a declared header keeps typo validation', () => {
  let reads = 0
  const schema = new Proxy(['id'], { get(target, key, receiver) {
    if (key === 'length') { reads++; return reads === 1 ? 1 : 0 }
    return Reflect.get(target, key, receiver)
  } })
  assert.throws(() => Source.queryRecords([], 'SELECT typo FROM records', 'records', schema), /no such column: typo/)
  assert.equal(reads, 1)
  assert.deepEqual(Source.queryRecords([], 'SELECT id FROM records', 'records', ['id']), [])
})
