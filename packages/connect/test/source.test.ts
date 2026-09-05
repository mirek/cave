import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Source } from '@cavelang/connect'

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

test('loaded CSV records retain inclusive physical line spans', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  const path = join(dir, 'people.csv')
  writeFileSync(path, 'id,notes\n1,one\n2,"two\nlines"\n')
  const loaded = await Source.load(path)
  assert.deepEqual(loaded.spans, [
    { startLine: 2, endLine: 2 },
    { startLine: 3, endLine: 4 }
  ])
})

test('json sources need an array of records; --records picks it by dot path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  const path = join(dir, 'data.json')
  writeFileSync(path, JSON.stringify({ data: { items: [{ id: 1 }, { id: 2 }] } }))
  await assert.rejects(Source.load(path), /--records/)
  const { records } = await Source.load(path, { records: 'data.items' })
  assert.deepEqual(records, [{ id: 1 }, { id: 2 }])
})

test('jsonl sources parse one object per non-blank line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
  const path = join(dir, 'events.jsonl')
  writeFileSync(path, '{"id":1}\n\n{"id":2}\n')
  const { records, format, spans } = await Source.load(path)
  assert.equal(format, 'jsonl')
  assert.deepEqual(records, [{ id: 1 }, { id: 2 }])
  assert.deepEqual(spans, [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3 }])
})

test('sqlite sources read a table or a query, read-only (spec §23)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-'))
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
    assert.deepEqual(Source.loadSync(join(dir, 'dup.csv'), { sql: 'SELECT id FROM records' }).records, [{ id: '2' }], 'the later cell wins, as without sql')
    writeFileSync(join(dir, 'empty.csv'), ' id , name \n')
    assert.deepEqual(Source.loadSync(join(dir, 'empty.csv'), { sql: 'SELECT id, name FROM records' }).records, [], 'the header survives an empty file, trimmed as record keys are')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
