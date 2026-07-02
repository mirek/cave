import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cave/store'

test('current belief = latest tx per claim key (spec §9.1)', () => {
  const store = open()
  store.ingest('Anthropic HAS ipo-timing: 2026-H2 @ 40% ; initial assessment')
  store.ingest('Anthropic HAS ipo-timing: 2026-H2 @ 65% ; updated after CFO statement')
  store.ingest('Anthropic HAS ipo-timing: 2026-H2 @ 35% ; market conditions worsened')
  const current = store.currentBeliefs()
  assert.equal(current.length, 1)
  assert.equal(current[0]!.conf, 0.35)
  assert.equal(current[0]!.comment, 'market conditions worsened')
  const history = store.history(current[0]!.claim_key)
  assert.deepEqual(history.map(row => row.conf), [0.4, 0.65, 0.35])
  store.close()
})

test('belief tracking is unified across forward and inverse names (spec §5.5)', () => {
  const store = open()
  store.ingest('packages/api PART-OF monorepo @ 50%')
  store.ingest('monorepo CONTAINS packages/api @ 90%')
  const current = store.currentBeliefs()
  assert.equal(current.length, 1, 'one fact, one key')
  assert.equal(current[0]!.conf, 0.9)
  assert.equal(current[0]!.verb, 'CONTAINS')
  assert.equal(current[0]!.subject, 'monorepo')
  assert.equal(store.history(current[0]!.claim_key).length, 2)
  assert.equal(store.history(current[0]!.claim_key)[0]!.raw_line, 'packages/api PART-OF monorepo @ 50%')
  store.close()
})

test('inverses are views, never rows (spec §13.3)', () => {
  const store = open()
  store.ingest('monorepo CONTAINS packages/api')
  const all = store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }
  assert.equal(all.n, 1)
  assert.deepEqual(
    store.forward('monorepo').map(fact => ({ verb: fact.verb, target: fact.target })),
    [{ verb: 'CONTAINS', target: 'packages/api' }]
  )
  assert.deepEqual(
    store.reverse('packages/api').map(fact => ({ verb: fact.verb, rel: fact.rel, source: fact.source })),
    [{ verb: 'CONTAINS', rel: 'PART-OF', source: 'monorepo' }]
  )
  store.close()
})

test('reverse read without a declaration falls back un-named (spec §5.5)', () => {
  const store = open()
  store.ingest('a LOGS b')
  const [fact] = store.reverse('b')
  assert.equal(fact!.verb, 'LOGS')
  assert.equal(fact!.rel, undefined)
  store.close()
})

test('negation rides the single row through both readings (spec §5.5)', () => {
  const store = open()
  store.ingest('server BLOCKS NOT db/writes')
  assert.equal(store.forward('server').length, 0, 'negated rows excluded from traversal by default')
  const [fact] = store.forward('server', { negated: true })
  assert.equal(fact!.row.negated, 1)
  const [reverse] = store.reverse('db/writes', { negated: true })
  assert.equal(reverse!.rel, 'BLOCKED-BY')
  store.close()
})

test('retraction by zero confidence hides rows from traversal (spec §9.3)', () => {
  const store = open()
  store.ingest('server USES old-cache')
  store.ingest('server USES old-cache @ 0% ; retracted')
  assert.equal(store.forward('server').length, 0)
  assert.equal(store.forward('server', { retracted: true }).length, 1)
  store.close()
})

test('contradictions coexist; the query layer resolves (spec §9.4)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60% @src:scanner-a')
  store.ingest('server IS NOT compromised @ 90% @src:forensics')
  assert.equal(store.currentBeliefs().length, 2, 'negation + different contexts → distinct keys')
  assert.equal(store.claimsAbout('server').length, 2)
  store.close()
})

test('flat and scoped tag queries (spec §13.5)', () => {
  const store = open()
  store.ingest([
    'vuln HAS severity: critical #security',
    'token-expiry CAUSE reject #topic:auth-security',
    'deploy NEEDS docker #env:prod #team:platform'
  ].join('\n'))
  assert.equal(store.byTag('security').length, 1)
  assert.equal(store.byTag('topic', 'auth-security').length, 1)
  assert.equal(store.byTag('env', 'prod').length, 1)
  assert.equal(store.byTag('topic').length, 0, 'flat lookup does not match scoped tags')
  store.close()
})

test('context query (spec §13.5)', () => {
  const store = open()
  store.ingest('memory-leak EXISTS @production\nlatency IS 30ms @staging')
  assert.equal(store.byContext('production').length, 1)
  assert.equal(store.byContext('production')[0]!.verb, 'EXISTS')
  store.close()
})

test('numeric threshold query (spec §13.5)', () => {
  const store = open()
  store.ingest('ChatGPT HAS weekly-users: 900M users/wk')
  const rows = store.db.prepare(
    "SELECT * FROM cave_claim WHERE attribute = 'weekly-users' AND value_num > 100000000"
  ).all()
  assert.equal(rows.length, 1)
  store.close()
})

test('comment search via SQL LIKE and FTS (spec §13.5)', () => {
  const store = open()
  store.ingest('memory-leak CAUSE oom @ 70% ; confirmed by heap dump analysis')
  const like = store.db.prepare("SELECT * FROM cave_claim WHERE comment LIKE '%heap dump%'").all()
  assert.equal(like.length, 1)
  assert.equal(store.search('heap dump').length, 1, 'default phrase search')
  assert.equal(store.search('token-expiry').length, 0, 'hyphenated terms are safe by default')
  assert.equal(store.search('heap AND analysis', { raw: true }).length, 1, 'raw FTS5 syntax')
  store.close()
})

test('topic layer reads, forward and inverse of the same rows (spec §11.2)', () => {
  const store = open()
  store.ingest([
    'topic/auth-hardening IS topic',
    'topic/auth-hardening CONTAINS token-expiry',
    'topic/auth-hardening CONTAINS auth/middleware'
  ].join('\n'))
  assert.deepEqual(store.topicMembers('topic/auth-hardening'), ['token-expiry', 'auth/middleware'])
  assert.deepEqual(store.topicsOf('token-expiry'), ['topic/auth-hardening'])
  store.close()
})

test('qualifier edges persist with roles (spec §13.2)', () => {
  const store = open()
  const result = store.ingest([
    'server CAUSE crash @ 80%',
    '  WHEN load > ~1000 req/s',
    '  UNLESS cache/enabled'
  ].join('\n'))
  assert.equal(result.ids.length, 3)
  assert.equal(result.edges, 2)
  const edges = store.edgesOf(result.ids[0]!)
  assert.deepEqual(edges.map(edge => edge.role).sort(), ['WHEN', 'WHEN'])
  const conditionVerbs = edges.map(edge => edge.child.verb).sort()
  assert.deepEqual(conditionVerbs, ['EXCEEDS', 'EXISTS'])
  store.close()
})

test('value normalization in columns (spec §13.4 steps 7–9)', () => {
  const store = open()
  store.ingest('OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr @2026-Q1 @ 90%')
  const [row] = store.currentBeliefs()
  assert.equal(row!.value_text, '~20B USD/yr')
  assert.equal(row!.value_num, 20_000_000_000)
  assert.equal(row!.value_unit, 'USD/yr')
  assert.equal(row!.value_approx, 1)
  assert.equal(row!.delta_num, 2_000_000_000)
  assert.equal(row!.sigma_level, 2)
  assert.equal(row!.conf, 0.9)
  store.close()
})

test('strict ingest throws on problems; lenient collects them', () => {
  const store = open()
  assert.throws(() => store.ingest('a uses b', { strict: true }), /line 1/)
  const lenient = store.ingest('a uses b\nc USES d')
  assert.equal(lenient.ids.length, 1)
  assert.equal(lenient.problems.length, 1)
  store.close()
})

test('toClaim reconstructs the canonical claim with side tables', () => {
  const store = open()
  store.ingest('auth/middleware HAS bug: token-expiry @production #security #topic:auth ! ; ouch')
  const [row] = store.currentBeliefs()
  const claim = store.toClaim(row!)
  assert.deepEqual(claim.contexts, ['production'])
  assert.deepEqual(claim.tags, [{ key: 'security' }, { key: 'topic', value: 'auth' }])
  assert.equal(claim.importance, true)
  assert.equal(claim.comment, 'ouch')
  assert.equal(claim.payload.kind, 'attribute')
  store.close()
})

test('code literals survive storage round trip', () => {
  const store = open()
  store.ingest('`<=` FIX token-expiry @auth.ts:42\nauth/middleware CONTAINS code: `validateToken`')
  const rows = store.currentBeliefs()
  assert.equal(rows[0]!.subject, '`<=`')
  const codeValue = store.toClaim(rows[1]!)
  assert.equal(codeValue.payload.kind, 'attribute')
  if (codeValue.payload.kind === 'attribute') {
    assert.equal(codeValue.payload.value.kind, 'code')
    assert.equal(codeValue.payload.value.raw, 'validateToken')
  }
  store.close()
})
