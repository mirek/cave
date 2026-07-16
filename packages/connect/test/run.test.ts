import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { Template, connect, federatedQuery, digestOf, isConnected } from '@cavelang/connect'

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
  // A changed record still retracts the claim it no longer yields (spec §23.2).
  const report = connect(store, mapping, [{ id: 'billing', tool: 'mysql' }], { name: 'systems', key: 'id' })
  assert.equal(report.retracted, 1)
  assert.deepEqual(bindings(store, '?who USES postgres'), [])
  assert.deepEqual(bindings(store, '?who USES mysql'), ['billing'])
  store.close()
})
