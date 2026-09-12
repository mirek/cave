import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { open } from '@cavelang/store'
import { query, queryRecords, Record } from '@cavelang/query'

const fixtureText = readFileSync(
  new URL('./fixtures/query-match-v1.json', import.meta.url),
  'utf8'
)

test('cave.query-match/v1 fixture remains decodable', () => {
  const record = Record.decode(fixtureText)
  assert.deepEqual(record.bindings, { service: 'api' })
  assert.deepEqual(JSON.parse(Record.encode(record)), JSON.parse(fixtureText))
})

test('query bindings require plain string maps that retain their JSON object shape', () => {
  const base = { format: Record.format, version: Record.version }
  class Bindings { service = 'api' }
  for (const bindings of [new Bindings(), new String('api'), new Date(0), new Map([['service', 'api']]), new Set(['api'])]) {
    assert.throws(() => Record.decode({ ...base, bindings }), /malformed/)
  }
  for (const bindings of [{}, { service: 'api' }, Object.assign(Object.create(null), { service: 'api' })]) {
    const decoded = Record.decode({ ...base, bindings })
    assert.deepEqual(Record.decode(Record.encode(decoded)).bindings, { ...bindings })
  }
})

test('query record decoding captures validated bindings and owns nested data', () => {
  let reads = 0
  const input = { format: Record.format, version: Record.version,
    bindings: { get service() { return ++reads === 1 ? 'api' : 42 } },
    at: { num: 1, text: '1' } }
  const decoded = Record.decode(input)
  assert.equal(decoded.bindings['service'], 'api')
  assert.equal(reads, 1)
  input.at.num = Infinity
  assert.equal(decoded.at!.num, 1)
  assert.deepEqual(Record.decode(Record.encode(decoded)), decoded)
})

test('query record decoding rejects malformed interpolation metadata', () => {
  const base = { format: Record.format, version: Record.version, bindings: {} }
  for (const at of [null, [], '250', {}, { num: 250 }, { num: '250', text: '250' },
    { num: NaN, text: '250' }, { num: Infinity, text: '250' },
    { num: 250, text: 250 }, { num: 250, text: '250', unit: null },
    { num: 250, text: '250', unit: 1 }]) {
    assert.throws(() => Record.decode({ ...base, at }), /malformed/)
    assert.throws(() => Record.decode(JSON.stringify({ ...base, at })), /malformed/)
  }
})

test('raw JSON overflow rejects in query interpolation and nested claim confidence', () => {
  const fixture = Record.decode(fixtureText)
  const claimFixture = JSON.parse(readFileSync(new URL('../../store/test/fixtures/claim-record-v1.json', import.meta.url), 'utf8'))
  for (const token of ['1e400', '-1e400']) {
    const interpolation = `{"format":"${Record.format}","version":${Record.version},"bindings":{},"at":{"num":${token},"text":"overflow"}}`
    assert.throws(() => Record.decode(interpolation), /malformed/)
    for (const field of ['claim', 'support'] as const) {
      const claim = { ...claimFixture, claim: { ...claimFixture.claim, conf: 'overflow-marker' } }
      const record = { ...fixture, [field]: field === 'claim' ? claim : [claim] }
      const json = JSON.stringify(record).replace('"overflow-marker"', token)
      assert.throws(() => Record.decode(json), /confidence|finite|malformed/)
    }
  }
  const finite = { format: Record.format, version: Record.version, bindings: {}, at: { num: 1e308, text: 'large' } }
  assert.deepEqual(Record.decode(JSON.stringify(finite)), finite)
  assert.deepEqual(Record.decode(fixtureText), fixture)
})

test('interpolated query records round-trip through the decoder', () => {
  const store = open()
  try {
    store.ingest('acme HAS headcount: 100 -> 400 people @2025..2027')
    const [record] = queryRecords(store, 'acme HAS headcount: ?n', { at: '2026' })
    assert.deepEqual(record!.at, { num: 250, text: '250 people', unit: 'people' })
    assert.deepEqual(Record.decode(Record.encode(record!)), record)
  } finally { store.close() }
})

test('interpolation records preserve numeric precision beside rounded display text', () => {
  const store = open()
  try {
    store.ingest('acme HAS rate: 100 -> 999.99 req/s @2025..2027')
    const [record] = queryRecords(store, 'acme HAS rate: ?n', { at: '2026' })
    assert.equal(record!.at!.num, 549.995)
    assert.equal(record!.at!.text, '550 req/s')
    assert.equal(record!.bindings['n'], '550 req/s')
    assert.deepEqual(Record.decode(Record.encode(record!)), record)
  } finally { store.close() }
})

test('queryRecords returns versioned claim records without storage columns', () => {
  const store = open()
  try {
    store.ingest('api USES jwt @ 90%')
    const matches = queryRecords(store, '?service USES jwt')
    assert.equal(matches[0]?.format, Record.format)
    assert.equal(matches[0]?.version, Record.version)
    assert.deepEqual(matches[0]?.bindings, { service: 'api' })
    assert.equal(matches[0]?.claim?.claim.verb, 'USES')
    assert.doesNotMatch(JSON.stringify(matches), /claim_key|raw_line|value_text/)
    assert.deepEqual(Record.decode(JSON.stringify(matches[0])), matches[0])
    assert.throws(() => Record.decode({ format: Record.format, version: 2 }), /unsupported.*version 2/)
  } finally {
    store.close()
  }
})

test('support array holes cannot bypass nested claim validation', () => {
  const store = open()
  let fixture: Record.t
  try {
    store.ingest('api USES jwt')
    fixture = queryRecords(store, '?service USES jwt')[0]!
  } finally { store.close() }
  assert.ok(fixture.claim)
  for (const support of [new Array(1), [fixture.claim, , fixture.claim], [undefined], [null]]) {
    assert.throws(() => Record.decode({ ...fixture, support }), /CAVE record:/)
    assert.throws(() => Record.decode(JSON.stringify({ ...fixture, support })), /CAVE record:/)
  }
  assert.deepEqual(Record.decode({ ...fixture, support: [] }).support, [])
  assert.deepEqual(Record.decode({ ...fixture, support: [fixture.claim] }).support, [fixture.claim])
})

test('support decoding validates indexed evidence independently of custom iterators', () => {
  const store = open()
  let fixture: Record.t
  try {
    store.ingest('api USES jwt')
    fixture = queryRecords(store, '?service USES jwt')[0]!
  } finally { store.close() }
  assert.ok(fixture.claim)
  let iterations = 0
  const support = [fixture.claim]
  support[Symbol.iterator] = () => { iterations++; return [].values() }
  assert.deepEqual(Record.decode({ ...fixture, support }).support, [fixture.claim])
  const invalid = [null]
  invalid[Symbol.iterator] = () => { iterations++; return [].values() }
  assert.throws(() => Record.decode({ ...fixture, support: invalid }), /CAVE record:/)
  const sparse = new Array(1)
  sparse[Symbol.iterator] = () => { iterations++; return [].values() }
  assert.throws(() => Record.decode({ ...fixture, support: sparse }), /CAVE record:/)
  assert.equal(iterations, 0)
})

test('nested query evidence rejects inconsistent value and uncertainty projections', () => {
  for (const text of ['20 ms +/- 2 ms (3σ)', '100 -> 400 ms @2025..2027']) {
    const store = open()
    try {
      store.ingest(`api HAS latency: ${text}`)
      const [match] = queryRecords(store, 'api HAS latency: ?n')
      const evidence = match!.claim!
      const claim = evidence.claim
      if (claim.payload.kind !== 'attribute') throw new Error('expected attribute')
      const corruptions = [{ ...claim, payload: { ...claim.payload,
        value: { ...claim.payload.value, num: 99 } } },
        ...(claim.delta === undefined ? [] : [{ ...claim, delta: { ...claim.delta, num: 99 } }])]
      for (const corrupted of corruptions) {
        const invalid = { ...evidence, claim: corrupted }
        for (const record of [{ ...match, claim: invalid },
          { format: Record.format, version: Record.version, bindings: {}, support: [invalid] }]) {
          assert.throws(() => Record.decode(record), /CAVE record: malformed/)
          assert.throws(() => Record.decode(JSON.stringify(record)), /CAVE record: malformed/)
        }
      }
      const valid = { format: Record.format, version: Record.version, bindings: {}, support: [evidence] }
      assert.deepEqual(Record.decode(Record.encode(valid)), valid)
    } finally { store.close() }
  }
})

test('queryRecords versions transitive support claims too', () => {
  const store = open()
  try {
    store.ingest('a EXTENDS b\nb EXTENDS c')
    const matches = queryRecords(store, 'a EXTENDS+ c', { support: true })
    assert.equal(matches[0]?.support?.length, 2)
    assert.ok(matches[0]?.support?.every(record => record.format === 'cave.claim'))
  } finally {
    store.close()
  }
})

test('query record construction captures match fields before evidence projection', t => {
  const store = open()
  try {
    store.ingest('acme HAS headcount: 100 -> 400 people @2025..2027')
    const match = query(store, 'acme HAS headcount: ?n', { at: '2026' })[0]!
    const reads = { bindings: 0, row: 0, rows: 0, at: 0 }
    const supplied = {
      get bindings() { reads.bindings++; return match.bindings },
      get row() { reads.row++; return match.row },
      get rows() { reads.rows++; return match.rows },
      get at() { reads.at++; return match.at },
    }
    const project = store.recordOf.bind(store)
    t.mock.method(store, 'recordOf', (row: Parameters<typeof project>[0]) => {
      ;(match.bindings as { n: string }).n = 'changed'
      if (match.at !== undefined) (match.at as { num: number }).num = Infinity
      return project(row)
    })
    const record = Record.of(store, supplied)
    assert.deepEqual(reads, { bindings: 1, row: 1, rows: 1, at: 1 })
    assert.equal(record.bindings.n, '250 people')
    assert.equal(record.at!.num, 250)
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  } finally { store.close() }
})

test('query record support rows cannot change between evidence projections', t => {
  const store = open()
  try {
    store.ingest('a EXTENDS b\nb EXTENDS c')
    const match = query(store, 'a EXTENDS+ c', { support: true })[0]!
    assert.equal(match.rows!.length, 2)
    const expected = Record.of(store, match)
    const project = store.recordOf.bind(store)
    let calls = 0
    t.mock.method(store, 'recordOf', (row: Parameters<typeof project>[0]) => {
      if (++calls === 1) (match.rows![1] as { tx: string }).tx = 'changed'
      return project(row)
    })
    const record = Record.of(store, match)
    assert.equal(calls, 2)
    assert.deepEqual(record, expected)
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  } finally { store.close() }
})

test('query record construction rejects malformed bindings and interpolation before projection', t => {
  const store = open()
  try {
    store.ingest('api IS service')
    const row = store.currentBeliefs()[0]!
    let projections = 0
    const project = store.recordOf.bind(store)
    t.mock.method(store, 'recordOf', (value: Parameters<typeof project>[0]) => {
      projections++
      return project(value)
    })
    class Bindings { service = 'api' }
    for (const bindings of [null, [], new Bindings(), new Map([['service', 'api']]), { service: 42 }]) {
      assert.throws(() => Record.of(store, { bindings, row } as never), /malformed/)
    }
    for (const at of [null, {}, { num: Infinity, text: '1' }, { num: 1, text: 1 }, { num: 1, text: '1', unit: 42 }]) {
      assert.throws(() => Record.of(store, { bindings: {}, row, at } as never), /malformed.*interpolation/)
    }
    for (const rows of [new Array(1), [row, , row], [undefined], [null]]) {
      assert.throws(() => Record.of(store, { bindings: {}, row, rows } as never), /malformed.*support/)
    }
    assert.equal(projections, 0)
    for (const bindings of [{ service: 'api' }, Object.assign(Object.create(null), { service: 'api' })]) {
      const record = Record.of(store, { bindings, row, at: { num: 1.2345, text: '1.23' } })
      assert.deepEqual(Record.decode(Record.encode(record)), record)
    }
    assert.equal(projections, 2)
  } finally { store.close() }
})
