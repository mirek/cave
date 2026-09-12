import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Key, Value } from '@cavelang/core'
import { emitClaim } from '@cavelang/canonical'
import { open, Record } from '@cavelang/store'

const fixtureText = readFileSync(
  new URL('./fixtures/claim-record-v1.json', import.meta.url),
  'utf8'
)

test('cave.claim/v1 fixture decodes and preserves its semantic identity', () => {
  const record = Record.decode(fixtureText)
  assert.equal(record.format, 'cave.claim')
  assert.equal(record.version, 1)
  assert.equal(Key.of(record.claim), record.key)
  assert.equal(record.canonical, record.claim.raw)
  assert.deepEqual(JSON.parse(Record.encode(record)), JSON.parse(fixtureText))
})

test('recordOf maps storage columns to the stable semantic contract', () => {
  const store = open()
  try {
    store.ingest('api HAS owner: platform @src:inventory #team:core @ 90%')
    const record = store.recordOf(store.currentBeliefs()[0]!)
    const json = Record.encode(record)
    assert.equal(record.claim.payload.kind, 'attribute')
    assert.deepEqual(record.provenance.sources, ['inventory'])
    assert.doesNotMatch(json, /claim_key|raw_line|value_text|value_num/)
    assert.equal(Record.decode(json).key, record.key)
  } finally {
    store.close()
  }
})

test('record provenance arrays reject holes and non-string entries', () => {
  const fixture = Record.decode(fixtureText)
  for (const contexts of [new Array(1), [undefined], [null], [1]]) {
    assert.throws(() => Record.decode({ ...fixture, claim: { ...fixture.claim, contexts } }),
      /malformed cave.claim\/v1$/)
  }
  for (const dimension of ['actors', 'sources', 'runs', 'domains'] as const) {
    for (const entries of [new Array(1), ['known', , 'other'], [undefined], [null], [1]]) {
      const record = { ...fixture, provenance: { ...fixture.provenance, [dimension]: entries } }
      assert.throws(() => Record.decode(record), /malformed/)
      assert.throws(() => Record.decode(JSON.stringify(record)), /malformed/)
    }
    for (const entries of [[], ['known', 'other']]) {
      const record = { ...fixture, provenance: { ...fixture.provenance, [dimension]: entries } }
      assert.deepEqual(Record.decode(record).provenance[dimension], entries)
    }
  }
})

test('record provenance obeys interchange field and Unicode validation without reordering valid arrays', () => {
  const fixture = Record.decode(fixtureText)
  for (const dimension of ['actors', 'sources', 'runs', 'domains'] as const) {
    for (const entries of [[''], ['\ud800'], ['before\udc00after']]) {
      const record = { ...fixture, provenance: { ...fixture.provenance, [dimension]: entries } }
      assert.throws(() => Record.decode(record), /malformed/)
      assert.throws(() => Record.decode(JSON.stringify(record)), /malformed/)
    }
    const entries = ['z', 'café', '😀', '\ufffd', 'before\0after', 'a', 'z']
    const record = { ...fixture, provenance: { ...fixture.provenance, [dimension]: entries } }
    assert.deepEqual(Record.decode(record).provenance[dimension], entries)
    assert.deepEqual(Record.decode(JSON.stringify(record)).provenance[dimension], entries)
  }
  const unknown = { ...fixture, provenance: { ...fixture.provenance, extra: [] } }
  assert.throws(() => Record.decode(unknown), /malformed/)
  assert.throws(() => Record.decode(JSON.stringify(unknown)), /malformed/)
})

test('record tags cannot pass validation through canonical string coercion', () => {
  const fixture = Record.decode(fixtureText)
  const flat = { ...fixture, claim: { ...fixture.claim, tags: [{ key: 'security' }] },
    canonical: fixture.canonical.replace('#team:core', '#security') }
  assert.deepEqual(Record.decode(JSON.stringify(flat)).claim.tags, [{ key: 'security' }])
  for (const [tag, rendered] of [
    [{ key: 1, value: 'core' }, '#1:core'],
    [{ key: 'team', value: 1 }, '#team:1'],
    [{ value: 'core' }, '#undefined:core'],
    [{ key: 'team', value: null }, '#team:null'],
    ['team', '#undefined']
  ] as const) {
    const record = { ...fixture, claim: { ...fixture.claim, tags: [tag] },
      canonical: fixture.canonical.replace('#team:core', rendered) }
    assert.throws(() => Record.decode(record), /malformed/)
    assert.throws(() => Record.decode(JSON.stringify(record)), /malformed/)
  }
})

test('record term kinds and text are validated independently of semantic identity', () => {
  const store = open()
  try {
    store.ingest('api USES jwt')
    const fixture = store.recordOf(store.currentBeliefs()[0]!)
    for (const term of [{ kind: 'unknown', text: 'api' }, { text: 'api' }, { kind: 'entity', text: 42 }]) {
      for (const slot of ['subject', 'object']) {
        const claim = (slot === 'subject' ? { ...fixture.claim, subject: term } :
          { ...fixture.claim, payload: { kind: 'relation', object: term } }) as typeof fixture.claim
        // Deliberately malformed input must not be constructed through the validating emitter.
        const canonical = slot === 'subject' ? `${String(term.text)} USES jwt` : `api USES ${String(term.text)}`
        const record = { ...fixture, claim, key: Key.of(claim), canonical }
        assert.throws(() => Record.decode(record), /malformed/)
        assert.throws(() => Record.decode(JSON.stringify(record)), /malformed/)
      }
    }
    for (const kind of ['entity', 'text', 'code'] as const) {
      const claim = { ...fixture.claim, subject: { kind, text: 'api' },
        payload: { kind: 'relation', object: { kind, text: 'jwt' } } } as const
      const record = { ...fixture, claim, key: Key.of(claim), canonical: emitClaim(claim) }
      assert.deepEqual(Record.decode(JSON.stringify(record)).claim, claim)
    }
  } finally { store.close() }
})

test('record payloads reject unknown kinds and malformed value fields', () => {
  const fixture = Record.decode(fixtureText)
  const value = { kind: 'atom', raw: 'platform', approx: false }
  for (const payload of [{ kind: 'unknown' }, {},
    { kind: 'attribute', attribute: 1, value },
    ...[{ ...value, kind: 'unknown' }, { ...value, raw: 1 }, { ...value, approx: 'false' },
      { ...value, unit: null }, { ...value, num: Infinity }, { ...value, from: '1' },
      { ...value, to: NaN }].flatMap(value => [
        { kind: 'attribute', attribute: 'owner', value }, { kind: 'metric', value }
      ])]) {
    const claim = { ...fixture.claim, payload } as typeof fixture.claim
    // Deliberately malformed transport input must not depend on emitter acceptance.
    const record = { ...fixture, claim, key: Key.of(claim) }
    assert.throws(() => Record.decode(record), /malformed.*payload/)
    assert.throws(() => Record.decode(JSON.stringify(record)), /malformed.*payload/)
  }
})

test('record payload decoding preserves every value kind and bare existence', () => {
  const store = open()
  try {
    for (const text of ['42', '10 -> 20', '2026-Q1', 'platform', '"hello"', '`x`']) {
      store.ingest(`api HAS value: ${text}`)
      const record = store.recordOf(store.currentBeliefs()[0]!)
      assert.deepEqual(Record.decode(Record.encode(record)), record)
    }
    store.ingest('thing EXISTS')
    const row = store.currentBeliefs().find(row => row.subject === 'thing')!
    const record = store.recordOf(row)
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  } finally { store.close() }
})

test('record optional metadata rejects invalid sigma levels and malformed uncertainty values', () => {
  const fixture = Record.decode(fixtureText)
  for (const metadata of [
    ...[0, -1, Infinity, '2', null].map(sigmaLevel => ({ sigmaLevel })),
    ...[{ kind: 'unknown', raw: '2', approx: false }, { kind: 'number', raw: '2', approx: 'false' }]
      .map(delta => ({ delta }))
  ]) {
    const claim = { ...fixture.claim, ...metadata } as typeof fixture.claim
    // Malformed transport data must reach the decoder without emitter validation.
    const record = { ...fixture, claim }
    assert.throws(() => Record.decode(record), /malformed.*metadata/)
    assert.throws(() => Record.decode(JSON.stringify(record)), /malformed.*metadata/)
  }
  for (const comment of [null, 1, {}]) {
    assert.throws(() => Record.decode({ ...fixture, claim: { ...fixture.claim, comment } }), /malformed/)
  }
  const store = open()
  try {
    store.ingest('api HAS latency: 20 ms +/- 2 ms (3σ) ; measured')
    const record = store.recordOf(store.currentBeliefs()[0]!)
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  } finally { store.close() }
})

test('record numeric projections must agree with their authored value', () => {
  const store = open()
  try {
    for (const text of ['42 ms', '~42 ms', '10 -> 20 ms', 'platform', '"42"', '`42`']) {
      store.ingest(`api HAS value: ${text}`)
      const fixture = store.recordOf(store.currentBeliefs()[0]!)
      assert.equal(fixture.claim.payload.kind, 'attribute')
      if (fixture.claim.payload.kind !== 'attribute') throw new Error('expected attribute')
      for (const patch of [{ num: 99 }, { from: 99 }, { to: 99 }, { unit: 's' },
        { approx: !fixture.claim.payload.value.approx }]) {
        const claim = { ...fixture.claim, payload: { ...fixture.claim.payload,
          value: { ...fixture.claim.payload.value, ...patch } } }
        const record = { ...fixture, claim }
        assert.throws(() => Record.decode(record), /malformed/)
        assert.throws(() => Record.decode(JSON.stringify(record)), /malformed/)
      }
    }
    store.ingest(`api HAS value: ${'9'.repeat(400)}`)
    const large = store.recordOf(store.currentBeliefs()[0]!)
    assert.deepEqual(Record.decode(Record.encode(large)), large)
  } finally { store.close() }
})

test('record uncertainty requires a positive finite scalar like authored claims', () => {
  const fixture = Record.decode(fixtureText)
  for (const delta of ['0', '-2', 'platform', '10 -> 20', '9'.repeat(400)].map(Value.parse)
    .concat([Value.ofText('2'), Value.ofCode('2')])) {
    const claim = { ...fixture.claim, delta }
    const record = { ...fixture, claim }
    assert.throws(() => Record.decode(record), /malformed.*metadata/)
    assert.throws(() => Record.decode(JSON.stringify(record)), /malformed.*metadata/)
  }
  for (const text of ['0.001', '~2 ms']) {
    const claim = { ...fixture.claim, delta: Value.parse(text) }
    const record = { ...fixture, claim, canonical: emitClaim(claim) }
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  }
})

test('record construction validates and captures row identity once', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    const row = store.currentBeliefs()[0]!
    const claim = store.toClaim(row), provenance = store.provenanceOf(row)
    for (const identity of [
      { id: null, tx: row.tx },
      { id: 'private-invalid-id', tx: 'private-invalid-id' },
      { id: '018F0000-0000-7000-8000-000000000002', tx: '018F0000-0000-7000-8000-000000000002' }
    ]) {
      assert.throws(() => Record.of({ ...row, ...identity } as typeof row, claim, provenance), /transaction identity/)
    }
    let idReads = 0, txReads = 0, keyReads = 0
    const record = Record.of({ ...row,
      get id() { return ++idReads === 1 ? row.id : 'private-later-id' },
      get tx() { return ++txReads === 1 ? row.tx : 'private-later-tx' },
      get claim_key() { return ++keyReads === 1 ? row.claim_key : 'private-later-key' }
    }, claim, provenance)
    assert.equal(idReads, 1)
    assert.equal(txReads, 1)
    assert.equal(keyReads, 1)
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  } finally { store.close() }
})

test('record transaction identity requires the same UUIDv7 for id and tx', () => {
  const fixture = Record.decode(fixtureText)
  const other = '018f0000-0000-7000-8000-000000000002'
  for (const patch of [{ id: other }, { tx: other }]) {
    const record = { ...fixture, ...patch }
    assert.throws(() => Record.decode(record), /malformed.*transaction identity/)
    assert.throws(() => Record.decode(JSON.stringify(record)), /malformed.*transaction identity/)
  }
  const valid = { ...fixture, id: other, tx: other }
  assert.deepEqual(Record.decode(valid), valid)
  assert.deepEqual(Record.decode(JSON.stringify(valid)), valid)
})

test('record decoding captures object input before validation and owns nested values', () => {
  const fixture = Record.decode(fixtureText)
  let reads = 0
  const provenance = { ...fixture.provenance,
    get sources() { return ++reads === 1 ? ['valid'] : ['\ud800'] } }
  const decoded = Record.decode({ ...fixture, provenance })
  assert.deepEqual(decoded.provenance.sources, ['valid'])
  assert.equal(reads, 1)

  const input = JSON.parse(fixtureText)
  const owned = Record.decode(input)
  input.claim.subject.text = 'changed'
  input.claim.tags[0].value = 'changed'
  input.provenance.actors.push('changed')
  assert.deepEqual(owned, JSON.parse(fixtureText))
  assert.deepEqual(Record.decode(Record.encode(owned)), owned)
})

test('record decoder rejects malformed and unknown future versions', () => {
  assert.throws(() => Record.decode({ format: 'cave.claim', version: 2 }), /unsupported.*version 2/)
  assert.throws(() => Record.decode({ format: 'row', version: 1 }), /expected format/)
  assert.throws(() => Record.decode({ format: 'cave.claim', version: 1 }), /malformed/)
})

test('record construction validates captured provenance without reordering it', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    const row = store.currentBeliefs()[0]!, claim = store.toClaim(row)
    const base = store.provenanceOf(row)
    for (const sources of [[''], ['\ud800'], [null], new Array(1)]) {
      assert.throws(() => Record.of(row, claim, { ...base, sources } as typeof base), /malformed.*provenance/)
    }
    assert.throws(() => Record.of(row, claim, { ...base, extra: [] } as typeof base), /malformed.*provenance/)
    let reads = 0
    const sources = ['z', 'a', 'z']
    const record = Record.of(row, claim, { ...base,
      get sources() { return ++reads === 1 ? sources : [''] }
    })
    assert.equal(reads, 1)
    sources[0] = ''
    assert.deepEqual(record.provenance.sources, ['z', 'a', 'z'])
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  } finally { store.close() }
})

test('record construction captures claim getters and owns nested claim metadata', () => {
  const store = open()
  try {
    store.ingest('api HAS score: 42 @src:inventory #team:core')
    const row = store.currentBeliefs()[0]!
    const supplied = store.toClaim(row)
    let reads = 0
    const claim = { ...supplied, get subject() {
      reads++
      return supplied.subject
    } }
    const record = Record.of(row, claim, store.provenanceOf(row))
    assert.equal(reads, 1)
    const expected = Record.encode(record)
    ;(supplied.subject as { text: string }).text = 'changed'
    ;(supplied.contexts as string[]).push('src:changed')
    ;(supplied.tags[0] as { value: string }).value = 'changed'
    if (supplied.payload.kind === 'attribute') {
      ;(supplied.payload.value as { raw: string }).raw = '99'
    }
    assert.equal(Record.encode(record), expected)
    assert.deepEqual(Record.decode(expected), record)
  } finally { store.close() }
})


test('record construction rejects claim metadata that cannot decode', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    const row = store.currentBeliefs()[0]!, claim = store.toClaim(row)
    const provenance = store.provenanceOf(row)
    for (const patch of [
      { raw: undefined }, { raw: 42 }, { negated: 0 }, { negated: '' },
      { importance: 0 }, { importance: 'yes' },
      { subject: { kind: 'unknown', text: 'api' } },
      { payload: { kind: 'unknown' } },
    ]) {
      const malformed = { ...claim, ...patch } as unknown as typeof claim
      assert.throws(() => Record.of(row, malformed, provenance), /malformed.*cave.claim/)
    }
    const record = Record.of(row, claim, provenance)
    assert.deepEqual(Record.decode(Record.encode(record)), record)
  } finally { store.close() }
})
