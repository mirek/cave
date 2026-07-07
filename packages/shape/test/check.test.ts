import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { check, evaluate, expectations } from '@cavelang/shape'

test('EXPECTS declarations read back as expectations (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'service EXPECTS USES',
    'team EXPECTS PART-OF'
  ].join('\n'))
  const declared = expectations(store)
  assert.deepEqual(
    declared.map(({ type, kind, name }) => ({ type, kind, name })),
    [
      { type: 'service', kind: 'attribute', name: 'owner' },
      { type: 'service', kind: 'relation', name: 'USES' },
      { type: 'team', kind: 'relation', name: 'PART-OF' }
    ]
  )
  store.close()
})

test('retracting an expectation stops it checking (spec §20.1)', () => {
  const store = open()
  store.ingest('service EXPECTS owner\napi IS service')
  assert.equal(evaluate(store).violations.length, 1)
  store.ingest('service EXPECTS owner @ 0% ; too strict for now')
  assert.equal(evaluate(store).violations.length, 0)
  assert.equal(expectations(store).length, 0)
  store.close()
})

test('negated expectations never check (spec §20.1)', () => {
  const store = open()
  store.ingest('service EXPECTS NOT owner\napi IS service')
  assert.equal(evaluate(store).violations.length, 0)
  store.close()
})

test('targets bind through the EXTENDS taxonomy (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'microservice EXTENDS service',
    'api-gateway IS microservice',
    'billing IS service',
    'microservice HAS style: small ; the subclass itself is not an instance'
  ].join('\n'))
  const { violations, instances, checks } = evaluate(store)
  assert.deepEqual(
    violations.map(({ entity, via }) => ({ entity, via })).sort((a, b) => a.entity.localeCompare(b.entity)),
    [
      { entity: 'api-gateway', via: 'microservice' },
      { entity: 'billing', via: 'service' }
    ]
  )
  assert.equal(instances, 2)
  assert.equal(checks, 2)
  store.close()
})

test('attribute expectations are satisfied by current positive HAS claims (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'api IS service',
    'api HAS owner: platform-team'
  ].join('\n'))
  assert.equal(evaluate(store).violations.length, 0)
  store.ingest('api HAS owner: platform-team @ 0% ; team dissolved')
  assert.equal(evaluate(store).violations.length, 1, 'retraction re-opens the violation')
  store.close()
})

test('relation expectations follow the verb direction, inverses included (spec §20.1)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS USES',
    'team EXPECTS PART-OF',
    'api IS service',
    'checkout IS team'
  ].join('\n'))
  assert.equal(evaluate(store).violations.length, 2)
  store.ingest('api USES postgres')
  assert.equal(evaluate(store).violations.length, 1)
  store.ingest('org/payments CONTAINS checkout ; satisfies PART-OF via the stored primary row')
  assert.equal(evaluate(store).violations.length, 0)
  store.close()
})

test('violations make the report; satisfied instances do not (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'api IS service',
    'billing IS service',
    'billing HAS owner: payments-team'
  ].join('\n'))
  const report = check(store)
  assert.equal(report.violations.length, 1)
  assert.equal(report.violations[0]!.entity, 'api')
  assert.equal(report.coverage.checks, 2)
  assert.equal(report.coverage.satisfied, 1)
  store.close()
})

test('stale claims are current beliefs past the horizon (spec §20.2)', () => {
  const store = open()
  store.ingest('auth USES jwt\nserver IS production')
  const now = Date.now()
  const later = () => now + 91 * 86_400_000
  assert.equal(check(store, { now: () => now }).stale.length, 0)
  const stale = check(store, { now: later }).stale
  assert.equal(stale.length, 2)
  assert.ok(stale.every(({ ageDays }) => ageDays >= 90))
  assert.equal(check(store, { now: later, staleDays: 365 }).stale.length, 0)
  store.close()
})

test('superseding a claim resets its staleness clock (spec §20.2)', () => {
  const store = open()
  store.ingest('auth USES jwt')
  // Belief series: the current row is the fresh one; only it is considered.
  store.ingest('auth USES jwt @ 90%')
  const now = Date.now()
  assert.equal(check(store, { now: () => now }).stale.length, 0)
  assert.equal(check(store, { now: () => now + 91 * 86_400_000 }).stale.length, 1, 'one current row, once')
  store.close()
})

test('review candidates are current beliefs at conf 0.3–0.7 (spec §20.2, §13.5)', () => {
  const store = open()
  store.ingest([
    'a IS b @ 20%',
    'c IS d @ 30%',
    'e IS f @ 50%',
    'g IS h @ 70%',
    'i IS j @ 90%'
  ].join('\n'))
  const review = check(store).review
  assert.deepEqual(review.map(row => row.conf), [0.3, 0.5, 0.7])
  store.close()
})

test('alias value disagreements surface across series (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'postgres HAS version: 14',
    'postgresql HAS version: 15'
  ].join('\n'))
  const disagreements = check(store).disagreements
  assert.equal(disagreements.length, 1)
  assert.equal(disagreements[0]!.kind, 'value')
  assert.equal(disagreements[0]!.about, 'HAS version')
  assert.deepEqual(disagreements[0]!.entities, ['postgres', 'postgresql'])
  store.close()
})

test('alias polarity disagreements surface asserted vs negated (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'postgres IS production',
    'postgresql IS NOT production'
  ].join('\n'))
  const disagreements = check(store).disagreements
  assert.equal(disagreements.length, 1)
  assert.equal(disagreements[0]!.kind, 'polarity')
  assert.equal(disagreements[0]!.about, 'IS production')
  store.close()
})

test('agreeing, retracted, and differently scoped series never disagree (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'postgres ALIAS postgresql',
    'postgres HAS version: 15',
    'postgresql HAS version: 15 ; same value — agreement',
    'postgres IS production @prod',
    'postgresql IS NOT production @staging ; different scope — different fact',
    'postgres HAS license: bsd',
    'postgresql HAS license: mit'
  ].join('\n'))
  store.ingest('postgresql HAS license: mit @ 0% ; retracted — absence is not disagreement')
  assert.equal(check(store).disagreements.length, 0)
  store.close()
})

test('actor provenance stamps do not scope disagreements apart (spec §20.2, §9.5)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql')
  store.ingest('postgres HAS version: 14', { source: 'cli' })
  store.ingest('postgresql HAS version: 15', { source: 'agent/claude' })
  assert.equal(check(store).disagreements.length, 1)
  store.close()
})

test('coverage counts rows, facts, belief states and typed entities (spec §20.2)', () => {
  const store = open()
  store.ingest([
    'service EXPECTS owner',
    'api IS service',
    'api HAS owner: platform-team',
    'auth USES jwt @ 50%',
    'server IS NOT compromised @ 90%'
  ].join('\n'))
  store.ingest('auth USES jwt @ 0% ; retracted')
  const { coverage } = check(store)
  assert.equal(coverage.rows, 6)
  assert.equal(coverage.facts, 5)
  assert.equal(coverage.current, 3, 'positive current: EXPECTS, IS, HAS')
  assert.equal(coverage.retracted, 1)
  assert.equal(coverage.negated, 1)
  assert.equal(coverage.lowConfidence, 0)
  assert.equal(coverage.entities, 5, 'service, api, owner, server, compromised — retracted auth/jwt drop out')
  assert.equal(coverage.typedEntities, 1, 'api IS service; the negated IS does not type server')
  assert.equal(coverage.expectations, 1)
  assert.equal(coverage.instances, 1)
  assert.equal(coverage.checks, 1)
  assert.equal(coverage.satisfied, 1)
  store.close()
})

test('an empty store checks clean (spec §20.2)', () => {
  const store = open()
  const report = check(store)
  assert.equal(report.violations.length, 0)
  assert.equal(report.coverage.rows, 0)
  assert.equal(report.coverage.averageConfidence, null)
  store.close()
})
