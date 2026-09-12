import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { Source, Template, connect, currentRowsUnder, federatedQuery, digestOf, isConnected } from '@cavelang/connect'

test('record fields are captured once for repeated template slots and keyed bookkeeping', () => {
  const store = open()
  try {
    const { mapping } = Template.parse('?id IS service\n?id HAS owner: ?owner')
    assert.ok(mapping)
    let reads = 0
    const record = { get id() { reads++; return reads === 1 ? 'api' : 'other' }, owner: 'team' }
    const options = { name: 'services', key: 'id' }
    const first = connect(store, mapping, [record], options)
    assert.deepEqual(first.failures, [])
    assert.equal(reads, 1)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'api' && row.attribute === 'owner' && row.value_text === 'team'))
    assert.ok(!store.currentBeliefs().some(row => row.subject === 'other'))
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const repeated = connect(store, mapping, [{ id: 'api', owner: 'team' }], options)
    assert.equal(repeated.skipped, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('current prefix reads cover empty and Unicode boundary prefixes', () => {
  const store = open()
  try {
    const names = ['ordinary', 'prefix/\ud7ff', 'prefix/\ue000', 'prefix/\uffff', 'prefix/\uffff/child',
      'prefix/😀', 'prefix/😀/child', 'prefix/\u{10ffff}', 'prefix/\u{10ffff}/child', '\u{10ffff}', '\u{10ffff}/child']
    assert.deepEqual(store.ingest(names.map(name => `${name} HAS value: 1`).join('\n')).problems, [])
    store.ingest('prefix/\uffff HAS value: 2')
    const all = store.currentBeliefs()
    for (const prefix of ['', 'prefix/\ud7ff', 'prefix/\uffff', 'prefix/😀', 'prefix/\u{10ffff}', '\u{10ffff}']) {
      assert.deepEqual(currentRowsUnder(store, prefix), all.filter(row => row.subject.startsWith(prefix)), JSON.stringify(prefix))
    }
    assert.throws(() => currentRowsUnder(store, '\ud800'), /unpaired UTF-16 surrogate/)
  } finally { store.close() }
})

const mappingText = [
  'WORKS-AT IS verb ; X is employed by organization Y',
  'WORKS-AT REVERSE EMPLOYS',
  '',
  '?id IS person',
  '?id HAS name: ?name',
  '?id HAS age: ?age',
  '?id WORKS-AT ?company'
].join('\n')

const mappingOf = (text: string): Template.Mapping => {
  const { mapping, problems } = Template.parse(text)
  assert.equal(problems.length, 0)
  return mapping!
}

const people = [
  { id: 'alice', name: 'Alice Liddell', age: '29', company: 'acme' },
  { id: 'bob', name: 'Bob', age: '41', company: 'initech' }
]

const bindings = (store: ReturnType<typeof open>, pattern: string): string[] =>
  query(store, pattern).map(match => Object.values(match.bindings)[0]!).sort()

test('unserializable source names retain the validation diagnostic before any writes', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const invalidNames = [circular, { nested: 1n }, { toJSON() { throw new Error('diagnostic serialization failed') } }]
  const store = open()
  try {
    const mapping = mappingOf(mappingText)
    connect(store, mapping, people, { name: 'people', key: 'id' })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const name of invalidNames) {
      assert.throws(() => connect(store, mapping, [], { name: name as unknown as string, prune: true }),
        /cave connect: unusable source name \[unprintable value\] — pass --name/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const recovered = connect(store, mapping, people, { name: 'people', key: 'id', prune: true })
    assert.equal(recovered.skipped, people.length)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('connect maps records to claims with record provenance (spec §23.2)', () => {
  const store = open()
  const report = connect(store, mappingOf(mappingText), people, { name: 'people', key: 'id' })
  assert.equal(report.records, 2)
  assert.equal(report.mapped, 2)
  assert.equal(report.failures.length, 0)
  assert.equal(report.added, 2 + 8) // prelude + 4 claims per record
  assert.deepEqual(bindings(store, '?who IS person'), ['alice', 'bob'])
  assert.deepEqual(bindings(store, '?who WORKS-AT acme'), ['alice'])
  // The REVERSE declaration from the prelude serves inverse reads.
  assert.deepEqual(bindings(store, '?org EMPLOYS alice'), ['acme'])
  // Every record claim carries the record stamp (spec §9.5).
  const stamped = store.byContext('src:connect/people/alice')
  assert.equal(stamped.length, 4)
  store.close()
})

test('connect attaches record spans alongside stable lifecycle identity (spec §9.8, §23.2)', () => {
  const store = open()
  connect(store, mappingOf('?id IS person'), people, {
    name: 'people',
    key: 'id',
    source: 'imports/people list.csv',
    spans: [{ startLine: 2, endLine: 2 }, { startLine: 3, endLine: 4 }]
  })
  const alice = store.toClaim(store.byContext('src:connect/people/alice')[0]!)
  assert.deepEqual(alice.contexts, [
    'src:connect/people/alice',
    'src:imports/people%20list.csv#L2'
  ])
  const bob = store.toClaim(store.byContext('src:connect/people/bob')[0]!)
  assert.ok(bob.contexts.includes('src:imports/people%20list.csv#L3-L4'))
  store.close()
})

test('invalid source provenance rejects before prelude or record updates and recovers after correction', () => {
  const spans = [{ startLine: 2, endLine: 2 }, { startLine: 3, endLine: 3 }]
  for (const invalid of [
    { source: '', spans },
    { source: '\ud800', spans },
    { source: 'people.csv', spans: [spans[0]!, { startLine: 0, endLine: 3 }] },
    { source: 'people.csv', spans: [spans[0]!, { startLine: 4, endLine: 3 }] }
  ]) {
    const store = open()
    try {
      const options = { name: 'people', key: 'id', source: 'people.csv', spans, prune: true }
      connect(store, mappingOf(mappingText), people, options)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const mapping = mappingOf(`review IS pass\n${mappingText}`)
      const refreshed = people.map(person => ({ ...person, company: 'newco' }))
      assert.throws(() => connect(store, mapping, refreshed, { ...options, ...invalid }),
        /source must not be empty|URI malformed|invalid source line span/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      if (invalid.source !== 'people.csv') {
        assert.throws(() => connect(store, mapping, [], { ...options, ...invalid }), /source must not be empty|URI malformed/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      assert.equal(connect(store, mapping, refreshed, options).mapped, 2)
      assert.deepEqual(bindings(store, '?who WORKS-AT newco'), ['alice', 'bob'])
      const settled = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(connect(store, mapping, refreshed, options).skipped, 2)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), settled)
    } finally { store.close() }
  }
})

test('re-runs are row-level incremental via digest claims (spec §23.2)', () => {
  const store = open()
  const mapping = mappingOf(mappingText)
  connect(store, mapping, people, { name: 'people', key: 'id' })
  const again = connect(store, mapping, people, { name: 'people', key: 'id' })
  assert.equal(again.mapped, 0)
  assert.equal(again.skipped, 2)
  assert.equal(again.added, 0)
  assert.ok(again.notes.includes('prelude unchanged, skipped'))
  // --force re-maps everything.
  const forced = connect(store, mapping, people, { name: 'people', key: 'id', force: true })
  assert.equal(forced.mapped, 2)
  store.close()
})

test('a changed keyed record supersedes attributes and retracts vanished relations (spec §23.2)', () => {
  const store = open()
  const mapping = mappingOf(mappingText)
  connect(store, mapping, people, { name: 'people', key: 'id' })
  const moved = [
    { id: 'alice', name: 'Alice Liddell', age: '30', company: 'globex' },
    people[1]!
  ]
  const report = connect(store, mapping, moved, { name: 'people', key: 'id' })
  assert.equal(report.mapped, 1)
  assert.equal(report.skipped, 1)
  assert.equal(report.retracted, 1) // WORKS-AT acme — the value change rides its own claim key
  // The attribute superseded in place: one claim key, latest value wins.
  assert.deepEqual(bindings(store, 'alice HAS age: ?age'), ['30'])
  // The old relation is retracted, not deleted — history survives.
  assert.deepEqual(bindings(store, '?who WORKS-AT acme'), [])
  assert.deepEqual(bindings(store, '?who WORKS-AT globex'), ['alice'])
  const retracted = store.byContext('src:connect/people/alice')
    .filter(row => row.object === 'acme')
  assert.ok(retracted.some(row => row.conf === 0))
  store.close()
})

test('the digest covers the mapping too — a mapping change re-fires records (spec §23.2)', () => {
  const store = open()
  connect(store, mappingOf(mappingText), people, { name: 'people', key: 'id' })
  const extended = mappingOf(`${mappingText}\n?id HAS source-row: ?id`)
  const report = connect(store, extended, people, { name: 'people', key: 'id' })
  assert.equal(report.mapped, 2)
  assert.deepEqual(bindings(store, 'alice HAS source-row: ?row'), ['alice'])
  store.close()
})

test('record lifecycle never retracts RENAMED-TO vocabulary declarations (spec §5.8, §23.2)', () => {
  const store = open()
  const records = [{ old: 'WORKS-AT', replacement: 'EMPLOYED-BY', id: 'vocabulary' }]
  connect(store, mappingOf('?old RENAMED-TO ?replacement'), records, { name: 'schema', key: 'id' })
  const changed = connect(store, mappingOf('?old IS verb'), records, { name: 'schema', key: 'id' })
  assert.equal(changed.retracted, 0)
  const declaration = store.currentBeliefs().find(row => row.verb === 'RENAMED-TO')
  assert.equal(declaration?.conf, 1)
  store.close()
})

test('connector pruning uses the option selected at entry', () => {
  const store = open()
  try {
    const mapping = mappingOf('?id IS person')
    connect(store, mapping, [{ id: 'alice' }], { name: 'people', key: 'id' })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    let reads = 0
    const report = connect(store, mapping, [], {
      name: 'people', key: 'id', get prune() { return ++reads === 1 ? false : true }
    })
    assert.equal(report.pruned, 0)
    assert.equal(reads, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(connect(store, mapping, [], { name: 'people', key: 'id', prune: true }).pruned, 1)
  } finally { store.close() }
})

test('--prune retracts records that left the source; failures never prune (spec §23.2)', () => {
  const store = open()
  const mapping = mappingOf(mappingText)
  connect(store, mapping, people, { name: 'people', key: 'id' })
  const onlyBob = [{ ...people[1]!, name: 'both " and `' }]
  const report = connect(store, mapping, onlyBob, { name: 'people', key: 'id', prune: true })
  // Bob failed to format — his previous claims must survive the prune.
  assert.equal(report.failures.length, 1)
  assert.equal(report.pruned, 1) // alice left the source
  assert.deepEqual(bindings(store, '?who IS person'), ['bob'])
  assert.equal(isConnected(store, 'connect/people/alice', digestOf('anything')), false)
  store.close()
})

test('pruning waits for identifiable records, then resumes after a key is repaired', () => {
  const store = open()
  try {
    const mapping = mappingOf(mappingText)
    connect(store, mapping, people, { name: 'people', key: 'id' })
    const damaged = [{ ...people[0]!, id: undefined }, { ...people[1]!, age: '42' }]
    const report = connect(store, mapping, damaged, { name: 'people', key: 'id', prune: true })
    assert.equal(report.failures.length, 1)
    assert.equal(report.mapped, 1, 'valid records still update')
    assert.equal(report.pruned, 0, 'a missing key is not evidence that a record disappeared')
    assert.ok(report.notes.some(note => note.includes('pruning skipped')))
    assert.deepEqual(bindings(store, '?who IS person'), ['alice', 'bob'])
    assert.deepEqual(bindings(store, 'bob HAS age: ?age'), ['42'])
    const repaired = connect(store, mapping, [{ ...people[1]!, age: '42' }], { name: 'people', key: 'id', prune: true })
    assert.equal(repaired.pruned, 1)
    assert.deepEqual(bindings(store, '?who IS person'), ['bob'])
  } finally { store.close() }
})

test('an unkeyed formatting failure cannot prune its former content identity', () => {
  const store = open()
  try {
    const mapping = mappingOf('?id HAS name: ?name')
    connect(store, mapping, people, { name: 'people' })
    const report = connect(store, mapping, [{ ...people[0]!, name: 'both " and `' }, people[1]!], { name: 'people', prune: true })
    assert.equal(report.failures.length, 1)
    assert.equal(report.pruned, 0)
    assert.deepEqual(bindings(store, '?who HAS name: ?name'), ['alice', 'bob'])
  } finally { store.close() }
})

test('unkeyed records are content-addressed: unchanged skips, changed appends (spec §23.2)', () => {
  const store = open()
  const mapping = mappingOf('?id IS person\n?id HAS age: ?age')
  const records = [{ id: 'alice', age: '29' }]
  connect(store, mapping, records, { name: 'people' })
  const again = connect(store, mapping, records, { name: 'people' })
  assert.equal(again.skipped, 1)
  const changed = connect(store, mapping, [{ id: 'alice', age: '30' }], { name: 'people' })
  assert.equal(changed.mapped, 1)
  // Content addressing has no previous self to diff against — no retraction.
  assert.equal(changed.retracted, 0)
  store.close()
})

test('missing fields drop lines; formatting problems fail the record atomically (spec §23.1–.2)', () => {
  const store = open()
  const mapping = mappingOf('?id IS person\n?id WORKS-AT ?company')
  const report = connect(store, mapping, [
    { id: 'carol' },
    { id: 'dave', company: 'both " and `' }
  ], { name: 'people', key: 'id' })
  assert.equal(report.dropped, 1)
  assert.equal(report.failures.length, 1)
  assert.match(report.failures[0]!.record, /dave/)
  // The failed record rolled back — nothing of dave landed, carol did.
  assert.equal(store.byContext('src:connect/people/dave').length, 0)
  assert.deepEqual(bindings(store, '?who IS person'), ['carol'])
  store.close()
})

test('ingestion failures roll back a record and report only successful updates and pruning', t => {
  const store = open()
  const mapping = mappingOf('?id IS record\n?id HAS value: ?value')
  const options = { name: 'counts', key: 'id', prune: true }
  const refreshed = [{ id: 'failed', value: 'new' }, { id: 'kept', value: 'new' }]
  try {
    connect(store, mapping, [
      { id: 'failed', value: 'old' }, { id: 'kept', value: 'old' }, { id: 'gone', value: 'old' }
    ], options)
    const history = () => store.byProvenance('run', 'connect/counts/failed')
    const before = history()
    const ingest = store.ingest.bind(store)
    const injected = t.mock.method(store, 'ingest', (...[text, settings]: Parameters<typeof store.ingest>) =>
      ingest(text.startsWith('failed IS record') ? `${text}\nbroken IS` : text, settings))
    const report = connect(store, mapping, refreshed, options)
    injected.mock.restore()
    assert.equal(report.records, 2)
    assert.equal(report.mapped, 1)
    assert.equal(report.skipped, 0)
    assert.equal(report.added, 2)
    assert.equal(report.retracted, 2)
    assert.equal(report.pruned, 1)
    assert.equal(report.failures.length, 1)
    assert.match(report.failures[0]!.record, /failed/)
    assert.deepEqual(history(), before)
    assert.deepEqual(bindings(store, 'failed HAS value: ?value'), ['old'])
    assert.deepEqual(bindings(store, 'kept HAS value: ?value'), ['new'])
    assert.deepEqual(bindings(store, '?id IS record'), ['failed', 'kept'])
    const recovered = connect(store, mapping, refreshed, options)
    assert.equal(recovered.mapped, 1)
    assert.equal(recovered.skipped, 1)
    assert.equal(recovered.added, 2)
    assert.equal(recovered.pruned, 0)
    assert.deepEqual(recovered.failures, [])
    assert.deepEqual(bindings(store, 'failed HAS value: ?value'), ['new'])
    const settled = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(connect(store, mapping, refreshed, options).skipped, 2)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), settled)
  } finally { store.close() }
})

test('federatedQuery consults the source at query time and persists nothing (spec §23.3)', () => {
  const store = open()
  store.ingest('acme IS company')
  const before = store.currentBeliefs().length
  const { matches, report } = federatedQuery(
    store, mappingOf(mappingText), people, { name: 'people', key: 'id' },
    '?who WORKS-AT acme'
  )
  assert.equal(report.mapped, 2)
  assert.deepEqual(matches.map(match => match.bindings['who']), ['alice'])
  // Everything rolled back — digests included.
  assert.equal(store.currentBeliefs().length, before)
  assert.equal(isConnected(store, 'connect/people/alice', digestOf('anything')), false)
  store.close()
})

test('a concurrent identical refresh is skipped after reserving the write transaction', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-refresh-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  const peer = open(db)
  const mapping = mappingOf('?id IS record')
  const records = [{ id: 'same' }]
  const options = { name: 'records', key: 'id' }
  try {
    const transaction = store.transaction.bind(store)
    let expected = ''
    t.mock.method(store, 'transaction', <T>(body: () => T): T => {
      if (expected === '') {
        connect(peer, mapping, records, options)
        expected = peer.exportText({ tx: true, maxSensitivity: 'restricted' })
      }
      return transaction(body)
    })
    const report = connect(store, mapping, records, options)
    assert.equal(report.skipped, 1)
    assert.equal(report.mapped, 0)
    assert.equal(report.added, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), expected)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('concurrent identical preludes skip atomically while force still appends', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-prelude-'))
  try {
    for (const preludeLifecycle of [false, true]) {
      const db = join(dir, `${preludeLifecycle}.db`)
      const store = open(db)
      const peer = open(db)
      const mapping = mappingOf('root IS record')
      const options = { name: 'source', preludeLifecycle }
      try {
        const transaction = store.transaction.bind(store)
        let expected = ''
        t.mock.method(store, 'transaction', <T>(body: () => T): T => {
          if (expected === '') {
            connect(peer, mapping, [], options)
            expected = peer.exportText({ tx: true, maxSensitivity: 'restricted' })
          }
          return transaction(body)
        })
        const report = connect(store, mapping, [], options)
        assert.equal(report.added, 0)
        assert.ok(report.notes.includes('prelude unchanged, skipped'))
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), expected)
        assert.ok(connect(store, mapping, [], { ...options, force: true }).added > 0)
      } finally { peer.close(); store.close() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('pruning discovers records after reserving the write transaction', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-connect-prune-'))
  const db = join(dir, 'k.db')
  const store = open(db)
  const peer = open(db)
  const mapping = mappingOf('?id IS record')
  try {
    connect(store, mapping, [{ id: 'first' }], { name: 'records', key: 'id' })
    const transaction = store.transaction.bind(store)
    let inserted = false
    t.mock.method(store, 'transaction', <T>(body: () => T): T => {
      if (!inserted) {
        inserted = true
        connect(peer, mapping, [{ id: 'second' }], { name: 'records', key: 'id' })
      }
      return transaction(body)
    })
    const report = connect(store, mapping, [], { name: 'records', key: 'id', prune: true })
    assert.equal(inserted, true)
    assert.equal(report.pruned, 2)
    assert.deepEqual(bindings(store, '?id IS record'), [])
    assert.equal(store.currentBeliefs().filter(row => row.attribute === 'connect-digest' && row.conf > 0).length, 0)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed pruning phase rolls back earlier record retirements', t => {
  const store = open()
  const mapping = mappingOf('?id IS record')
  try {
    connect(store, mapping, [{ id: 'first' }, { id: 'second' }], { name: 'records', key: 'id' })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const insert = store.insertResult.bind(store)
    let retirements = 0
    t.mock.method(store, 'insertResult', (...args: Parameters<typeof store.insertResult>) => {
      if (args[0].claims.some(entry => entry.claim.subject.text.startsWith('connect/records/') && entry.claim.conf === 0)) {
        retirements++
        if (retirements === 2) throw new Error('injected digest retirement failure')
      }
      return insert(...args)
    })
    assert.throws(() => connect(store, mapping, [], { name: 'records', key: 'id', prune: true }), /digest retirement failure/)
    assert.equal(retirements, 2)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('non-scalar and non-finite record keys fail without pruning prior records', () => {
  const store = open()
  const mapping = mappingOf('?name IS person')
  try {
    connect(store, mapping, [{ id: '1', name: 'ann' }, { id: '2', name: 'bob' }], { name: 'people', key: 'id' })
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const id of [{ nested: 1 }, [], NaN, Infinity, -Infinity, Symbol('id'), () => 'id']) {
      const report = connect(store, mapping, [{ id, name: 'changed' }], { name: 'people', key: 'id', prune: true })
      assert.equal(report.failures.length, 1)
      assert.equal(report.mapped, 0)
      assert.equal(report.pruned, 0)
      assert.match(report.failures[0]!.problems.join(' '), /usable scalar/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const ids = [0, false, 9007199254740993n, 'text']
    const valid = connect(store, mapping, ids.map((id, at) => ({ id, name: `name-${at}` })), { name: 'scalars', key: 'id' })
    assert.deepEqual(valid.failures, [])
    assert.equal(valid.mapped, ids.length)
    for (const id of ids) assert.ok(store.byContext(`src:connect/scalars/${id}`).length > 0)
  } finally { store.close() }
})

test('a failed duplicate keeps the last successful record while pruning genuinely absent keys', () => {
  const store = open()
  try {
    const mapping = mappingOf('?id HAS name: ?name')
    connect(store, mapping, [{ id: 'alice', name: 'old' }, { id: 'bob', name: 'absent' }], { name: 'people', key: 'id' })
    const report = connect(store, mapping, [
      { id: 'alice', name: 'updated' },
      { id: 'alice', name: 'both " and `' }
    ], { name: 'people', key: 'id', prune: true })
    assert.equal(report.failures.length, 1)
    assert.equal(report.mapped, 1)
    assert.equal(report.pruned, 1)
    assert.deepEqual(bindings(store, '?who HAS name: updated'), ['alice'])
    assert.equal(query(store, 'bob HAS name: ?name').length, 0)
    assert.ok(report.notes.some(note => note.includes('last successful record wins')))
  } finally { store.close() }
})

test('duplicate record keys note last-wins; sanitized keys stay context-safe (spec §23.2)', () => {
  const store = open()
  const mapping = mappingOf('?id HAS name: ?name')
  const report = connect(store, mapping, [
    { id: 'x 1;y', name: 'first' },
    { id: 'x 1;y', name: 'second' }
  ], { name: 'people', key: 'id' })
  assert.ok(report.notes.some(note => note.includes('duplicate record key')))
  // The claim subject keeps the exact (quoted) value; sanitization applies
  // only to record identity — the digest subject and the @src: stamp.
  assert.deepEqual(bindings(store, '?who HAS name: second'), ['"x 1;y"'])
  assert.equal(store.byContext('src:connect/people/x-1-y').length > 0, true)
  store.close()
})

test('an authored @src: context cannot bypass the record lifecycle stamp (BUGS.md src-stamp-bypass)', () => {
  const store = open()
  const mapping = mappingOf('?id USES ?tool @src:inventory')
  connect(store, mapping, [{ id: 'billing', tool: 'postgres' }], { name: 'systems', key: 'id' })
  // The record stamp lands alongside the authored source (spec §9.5).
  const stamped = store.byContext('src:connect/systems/billing')
  assert.ok(stamped.some(row => row.verb === 'USES' && row.object === 'postgres'))
  assert.ok(store.byProvenance('run', 'connect/systems/billing')
    .some(row => row.verb === 'USES' && row.object === 'postgres'))
  // A changed record still retracts the claim it no longer yields (spec §23.2).
  const report = connect(store, mapping, [{ id: 'billing', tool: 'mysql' }], { name: 'systems', key: 'id' })
  assert.equal(report.retracted, 1)
  assert.deepEqual(bindings(store, '?who USES postgres'), [])
  assert.deepEqual(bindings(store, '?who USES mysql'), ['billing'])
  store.close()
})


test('a record digest write exception rolls back that record, stops the pass and recovers on retry', t => {
  const store = open()
  const mapping = mappingOf('?id IS record\n?id HAS value: ?value')
  const options = { name: 'write-retry', key: 'id', prune: true }
  const refreshed = ['first', 'second', 'third'].map(id => ({ id, value: 'new' }))
  try {
    connect(store, mapping, ['first', 'second', 'third', 'gone'].map(id => ({ id, value: 'old' })), options)
    const history = () => ({
      claims: store.byContext('src:connect/write-retry/second'),
      digests: store.byContext('src:cave-connect').filter(row => row.subject === 'connect/write-retry/second')
    })
    const before = history()
    const ingest = store.ingest.bind(store)
    const failure = new Error('digest storage failed')
    let injectedWrites = 0
    const injected = t.mock.method(store, 'ingest', (...args: Parameters<typeof store.ingest>) => {
      const result = ingest(...args)
      if (args[0].startsWith('connect/write-retry/second HAS connect-digest:')) {
        injectedWrites += 1
        throw failure
      }
      return result
    })
    assert.throws(() => connect(store, mapping, refreshed, options), error => error === failure)
    assert.equal(injectedWrites, 1)
    injected.mock.restore()
    assert.deepEqual(history(), before)
    assert.deepEqual(bindings(store, '?id HAS value: new'), ['first'])
    assert.deepEqual(bindings(store, '?id HAS value: old'), ['gone', 'second', 'third'])
    const retried = connect(store, mapping, refreshed, options)
    assert.equal(retried.skipped, 1)
    assert.equal(retried.mapped, 2)
    assert.equal(retried.pruned, 1)
    assert.deepEqual(retried.failures, [])
    assert.deepEqual(bindings(store, '?id HAS value: new'), ['first', 'second', 'third'])
    assert.deepEqual(bindings(store, '?id HAS value: old'), [])
    const settled = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(connect(store, mapping, refreshed, options).skipped, 3)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), settled)
  } finally { store.close() }
})

test('retrying failed pruning retains committed record updates and skips their digests', t => {
  const store = open()
  const mapping = mappingOf('?id IS record\n?id HAS value: ?value')
  const options = { name: 'retry', key: 'id', prune: true }
  const refreshed = [{ id: 'kept', value: 'new' }]
  try {
    connect(store, mapping, [
      { id: 'kept', value: 'old' }, { id: 'first', value: 'one' }, { id: 'second', value: 'two' },
    ], options)
    const insert = store.insertResult.bind(store)
    let retirements = 0
    const injected = t.mock.method(store, 'insertResult', (...args: Parameters<typeof store.insertResult>) => {
      if (args[0].claims.some(entry => entry.claim.subject.text.startsWith('connect/retry/') && entry.claim.conf === 0)) {
        if (++retirements === 2) throw new Error('pruning interrupted')
      }
      return insert(...args)
    })
    assert.throws(() => connect(store, mapping, refreshed, options), /pruning interrupted/)
    assert.equal(retirements, 2)
    injected.mock.restore()
    assert.deepEqual(bindings(store, 'kept HAS value: ?value'), ['new'])
    assert.deepEqual(bindings(store, '?id IS record'), ['first', 'kept', 'second'])
    const committed = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const withoutPrune = connect(store, mapping, refreshed, { ...options, prune: false })
    assert.equal(withoutPrune.skipped, 1)
    assert.equal(withoutPrune.added, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), committed)
    const retried = connect(store, mapping, refreshed, options)
    assert.equal(retried.skipped, 1)
    assert.equal(retried.pruned, 2)
    assert.equal(retried.retracted, 4)
    assert.deepEqual(retried.failures, [])
    assert.deepEqual(bindings(store, '?id IS record'), ['kept'])
    const settled = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(connect(store, mapping, refreshed, options).pruned, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), settled)
  } finally { store.close() }
})


test('explicit claim mappings format the subject after the marker as an entity', () => {
  for (const subject of ['20 kg', '94.5%', '~20 kg']) {
    for (const marker of ['', '@claim ']) {
      const store = open()
      try {
        const mapping = mappingOf(`${marker}?subject IS record\n${marker}?subject HAS amount: ?amount`)
        const records = [{ id: 'one', subject, amount: '20 kg' }]
        const options = { name: 'measures', key: 'id' }
        const rendered = connect(store, mapping, records, options)
        assert.deepEqual(rendered.failures, [], `${marker}${subject}`)
        assert.equal(rendered.mapped, 1)
        assert.deepEqual(bindings(store, '?entity IS record'), [JSON.stringify(subject)])
        assert.deepEqual(bindings(store, `${JSON.stringify(subject)} HAS amount: ?value`), ['20 kg'])
        const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
        assert.equal(connect(store, mapping, records, options).skipped, 1)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      } finally { store.close() }
    }
  }
})


test('mapping qualifier entities retain subject formatting through negation and explicit markers', () => {
  for (const qualifier of ['WHEN', 'UNLESS', 'VIA', 'BECAUSE']) {
    for (const body of ['?subject', '?subject IS ready', '@claim ?subject IS ready', 'NOT ?subject IS ready', 'NOT @claim ?subject IS ready', '?subject > ?amount']) {
      const store = open()
      try {
        const mapping = mappingOf(`root IS record\n  ${qualifier} ${body}`)
        const fields = { id: 'one', subject: '20 kg', amount: '30 kg' }
        const result = connect(store, mapping, [fields], { name: 'qualifiers', key: 'id' })
        assert.deepEqual(result.failures, [], `${qualifier} ${body}`)
        assert.equal(result.mapped, 1)
        const rendered = Template.instantiate(mapping.templates, name => fields[name as keyof typeof fields])
        assert.ok(rendered.text.includes('"20 kg"'), rendered.text)
        if (body.includes('?amount')) assert.ok(rendered.text.includes(' > 30 kg'), rendered.text)
      } finally { store.close() }
    }
  }
})

test('record reconciliation isolates overlapping facts from other sources and authored claims', () => {
  const store = open()
  try {
    const mapping = mappingOf('?subject USES ?dependency @src:shared')
    const record = { id: 'same-key', subject: 'api', dependency: 'redis' }
    const left = { name: 'left', key: 'id', prune: true }
    const right = { name: 'right', key: 'id', prune: true }
    store.ingest('api USES redis @src:shared')
    connect(store, mapping, [record], left)
    connect(store, mapping, [record], right)
    const rows = () => store.currentBeliefs().filter(row => row.subject === 'api' && row.verb === 'USES')
    const original = rows()
    assert.equal(original.filter(row => row.conf > 0).length, 3)
    const protectedRows = original.filter(row => !store.toClaim(row).contexts.includes('src:connect/left/same-key'))
    const revised = connect(store, mapping, [{ ...record, dependency: 'postgres' }], left)
    assert.equal(revised.retracted, 1)
    assert.deepEqual(rows().filter(row => !store.toClaim(row).contexts.includes('src:connect/left/same-key')), protectedRows)
    assert.equal(rows().filter(row => store.toClaim(row).contexts.includes('src:connect/left/same-key') && row.conf > 0)[0]!.object, 'postgres')
    const pruned = connect(store, mapping, [], left)
    assert.equal(pruned.pruned, 1)
    assert.equal(pruned.retracted, 1)
    assert.deepEqual(rows().filter(row => row.conf > 0), protectedRows)
    assert.equal(connect(store, mapping, [record], right).skipped, 1)
    assert.equal(connect(store, mapping, [], right).pruned, 1)
    assert.deepEqual(rows().filter(row => row.conf > 0), protectedRows.filter(row => !store.toClaim(row).contexts.includes('src:connect/right/same-key')))
    assert.equal(rows().filter(row => row.conf > 0).length, 1)
    const restored = connect(store, mapping, [record], left)
    assert.equal(restored.mapped, 1)
    assert.equal(restored.skipped, 0)
    assert.equal(rows().filter(row => row.conf > 0).length, 2)
    const beforeRepeat = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(connect(store, mapping, [record], left).skipped, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), beforeRepeat)
  } finally { store.close() }
})

test('malformed record batches reject before prelude writes or pruning and recover', () => {
  const store = open()
  try {
    const original = Template.parse('?id IS service').mapping!
    const changed = Template.parse('batch IS revised\n?id IS service').mapping!
    const options = { name: 'services', key: 'id', prune: true }
    connect(store, original, [{ id: 'api' }, { id: 'worker' }], options)
    const before = store.exportText({ current: false, tx: true, maxSensitivity: 'restricted' })
    const sparse = [{ id: 'api' }, , ]
    const inherited = new Array(1)
    Object.setPrototypeOf(inherited, [{ id: 'api' }])
    for (const records of [sparse, null, {}, 'records', inherited, [{ id: 'api' }, null],
      [{ id: 'api' }, undefined], [{ id: 'api' }, 42], [{ id: 'api' }, []]]) {
      assert.throws(() => connect(store, changed, records as unknown as readonly Record<string, unknown>[], options),
        /records must be an array|record \d+ must be an object/)
      assert.equal(store.exportText({ current: false, tx: true, maxSensitivity: 'restricted' }), before)
    }
    const recovered = connect(store, changed, [{ id: 'api' }], options)
    assert.deepEqual(recovered.failures, [])
    assert.equal(recovered.pruned, 1)
    assert.equal(query(store, '?x IS service').length, 1)
    assert.equal(query(store, 'batch IS revised').length, 1)
  } finally { store.close() }
})

test('record array entries are captured once before provenance and mapping', () => {
  const store = open()
  try {
    const mapping = Template.parse('?id IS service').mapping!
    let reads = 0
    const records: Record<string, unknown>[] = []
    Object.defineProperty(records, 0, { enumerable: true, configurable: true,
      get() { reads++; return { id: reads === 1 ? 'original' : 'changed' } } })
    const report = connect(store, mapping, records, {
      name: 'services', key: 'id', source: 'services.json', spans: [{ startLine: 1, endLine: 1 }]
    })
    assert.deepEqual(report.failures, [])
    assert.equal(reads, 1)
    assert.equal(query(store, 'original IS service').length, 1)
    assert.equal(query(store, 'changed IS service').length, 0)
  } finally { store.close() }
})


test('SQL record capture keeps a changing array entry from causing false pruning', () => {
  const store = open()
  try {
    const mapping = Template.parse('?id IS service').mapping!
    const options = { name: 'services', key: 'id', prune: true }
    connect(store, mapping, [{ id: 'api' }], options)
    const before = store.exportText({ current: false, tx: true, maxSensitivity: 'restricted' })
    let reads = 0
    const records: Record<string, unknown>[] = []
    Object.defineProperty(records, 0, { enumerable: true, get() {
      reads++
      return reads === 1 ? { id: 'api' } : {}
    } })
    const projected = Source.queryRecords(records, 'SELECT id FROM records WHERE id IS NOT NULL')
    const report = connect(store, mapping, projected, options)
    assert.equal(report.pruned, 0)
    assert.equal(report.skipped, 1)
    assert.equal(reads, 1)
    assert.equal(store.exportText({ current: false, tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})


test('invalid proxy array lengths reject before writes and SQL projection and recover', () => {
  const store = open()
  try {
    const mapping = Template.parse('?id IS service').mapping!
    const changed = Template.parse('batch IS revised\n?id IS service').mapping!
    const options = { name: 'services', key: 'id', prune: true }
    connect(store, mapping, [{ id: 'api' }], options)
    const before = store.exportText({ current: false, tx: true, maxSensitivity: 'restricted' })
    for (const length of [NaN, -1, Infinity, 1.5, '0', null, undefined, 1n, 4294967296]) {
      const records = new Proxy([{ id: 'api' }], {
        get(target, key, receiver) { return key === 'length' ? length : Reflect.get(target, key, receiver) }
      })
      assert.throws(() => connect(store, changed, records, options), /records length must be a valid array length/)
      assert.throws(() => Source.queryRecords(records, 'SELECT COUNT(*) AS n FROM records'),
        /records length must be a valid array length/)
      assert.equal(store.exportText({ current: false, tx: true, maxSensitivity: 'restricted' }), before)
    }
    let reads = 0
    const records = new Proxy([{ id: 'api' }], {
      get(target, key, receiver) {
        if (key === 'length') { reads++; return reads === 1 ? 1 : NaN }
        return Reflect.get(target, key, receiver)
      }
    })
    const projected = Source.queryRecords(records, 'SELECT id FROM records')
    const report = connect(store, mapping, projected, options)
    assert.equal(reads, 1)
    assert.equal(report.skipped, 1)
    assert.equal(report.pruned, 0)
    assert.equal(store.exportText({ current: false, tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(connect(store, mapping, [], options).pruned, 1)
  } finally { store.close() }
})
