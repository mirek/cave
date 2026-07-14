import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { entity, history, lineage, overview, search, topic, topics } from '@cavelang/view'

/**
 * One store exercising every §30.2 view: attributes with uncertainty,
 * both relation directions through a declared inverse, topics, aliases,
 * a belief series with a retraction, a negated claim, an `EXPECTS`
 * violation, review-band confidence, and `BECAUSE`/`VIA` lineage edges.
 */
const fixture = () => {
  const store = open()
  store.ingest(`
service EXPECTS owner
api-gateway IS service
checkout IS service
checkout HAS owner: payments-team
api-gateway USES redis-cache @ 90%
api-gateway HAS error-rate: ~0.02 +/- 0.01 #ops
api-gateway IS NOT deprecated
platform CONTAINS api-gateway
platform CONTAINS checkout
checkout ALIAS checkout-svc
checkout-svc HAS latency: 120 ms @src:probe @ 50%
maybe-flaky CAUSE checkout/errors @ 40%
`, { source: 'test' })
  // A belief series: asserted, revised, retracted.
  store.ingest('cache-node IS healthy @ 90%', { source: 'test' })
  store.ingest('cache-node IS healthy @ 60%', { source: 'test' })
  store.ingest('cache-node IS healthy @ 0%', { source: 'test' })
  return store
}

test('overview: coverage, topics, violations, review candidates, recent (spec §30.2)', () => {
  const store = fixture()
  const data = overview(store)
  assert.ok(data.coverage.rows > 10)
  assert.ok(data.coverage.facts > 0)
  assert.equal(data.coverage.retracted, 1)
  assert.equal(data.coverage.negated, 1)
  // api-gateway IS service but has no owner attribute — a §20.2 violation.
  assert.equal(data.violations.total, 1)
  assert.equal(data.violations.items[0]!.entity, 'api-gateway')
  assert.equal(data.violations.items[0]!.name, 'owner')
  // conf 0.4 and 0.5 rows sit in the review band.
  assert.ok(data.review.total >= 2)
  // platform CONTAINS two members.
  assert.deepEqual(topics(store), [{ name: 'platform', members: 2 }])
  assert.deepEqual(data.topics, [{ name: 'platform', members: 2 }])
  // Recent is newest first — the retraction is the latest append.
  assert.equal(data.recent[0]!.conf, 0)
  assert.equal(data.recent[0]!.subject, 'cache-node')
  assert.equal(data.version, overview(store).version)
  store.close()
})

test('entity 360: facts, both relation directions, topics, activity (spec §30.2)', () => {
  const store = fixture()
  const data = entity(store, 'api-gateway')
  assert.deepEqual(data.aliases, ['api-gateway'])
  assert.deepEqual(data.types, ['service'])
  // Facts are object-less current claims — here the error-rate attribute.
  const attribute = data.facts.find(fact => fact.attribute === 'error-rate')
  assert.ok(attribute !== undefined)
  assert.equal(attribute.value, '~0.02')
  assert.equal(attribute.delta, '0.01')
  assert.deepEqual(attribute.tags, [{ key: 'ops' }])
  assert.ok(attribute.contexts.includes('src:test'))
  assert.ok(attribute.at.endsWith('Z'))
  // Forward relations carry the typing and the negated claim too — `IS
  // service` and `IS NOT deprecated` are relations (object payloads).
  assert.deepEqual(
    data.out.map(fact => [fact.verb, fact.negated, fact.object]).sort(),
    [['IS', false, 'service'], ['IS', true, 'deprecated'], ['USES', false, 'redis-cache']].sort()
  )
  // Reverse: platform CONTAINS api-gateway, read as PART-OF.
  const contains = data.in.find(fact => fact.verb === 'CONTAINS')
  assert.ok(contains !== undefined)
  assert.equal(contains.rel, 'PART-OF')
  assert.deepEqual(data.topics, ['platform'])
  assert.ok(data.total >= data.activity.length)
  store.close()
})

test('entity 360 widens through the alias closure only when asked (spec §13.6)', () => {
  const store = fixture()
  const plain = entity(store, 'checkout')
  assert.equal(plain.facts.some(fact => fact.attribute === 'latency'), false)
  const widened = entity(store, 'checkout', { aliases: true })
  assert.deepEqual(widened.aliases, ['checkout', 'checkout-svc'])
  const latency = widened.facts.find(fact => fact.attribute === 'latency')
  assert.ok(latency !== undefined, 'the aliased series shows, stored name kept')
  assert.equal(latency.subject, 'checkout-svc')
  store.close()
})

test('topic members are the forward CONTAINS read (spec §11.2)', () => {
  const store = fixture()
  assert.deepEqual(topic(store, 'platform').members, ['api-gateway', 'checkout'])
  assert.deepEqual(topic(store, 'nothing').members, [])
  store.close()
})

test('history: the belief series oldest first, last row current (spec §9.1)', () => {
  const store = fixture()
  const key = entity(store, 'cache-node').activity[0]!.key
  const series = history(store, key)
  assert.equal(series.rows.length, 3)
  assert.deepEqual(series.rows.map(row => row.conf), [0.9, 0.6, 0])
  assert.ok(series.rows[0]!.tx < series.rows[2]!.tx)
  assert.equal(history(store, 'no-such-key').rows.length, 0)
  store.close()
})

test('lineage walks BECAUSE/VIA both ways and re-states shared rows (spec §24.3, §28.4)', () => {
  const store = open()
  const base = store.ingest('a IS true\nb IS true', { source: 'test' })
  const derived = store.ingest('c IS true @ 80%', { source: 'rule/x' })
  const further = store.ingest('d IS true @ 60%', { source: 'rule/y' })
  const [aId, bId] = base.ids as [string, string]
  const cId = derived.ids[0]!
  const dId = further.ids[0]!
  store.appendEdges([
    { parentId: cId, role: 'BECAUSE', childId: aId },
    { parentId: cId, role: 'BECAUSE', childId: bId },
    // d cites c and (again) a — a is shared, so the up-walk from a and
    // the down-walk from d both meet it twice.
    { parentId: dId, role: 'BECAUSE', childId: cId },
    { parentId: dId, role: 'BECAUSE', childId: aId }
  ])
  const down = lineage(store, dId)!
  assert.equal(down.row.line, 'd IS true @ 60%')
  assert.deepEqual(down.cites.map(node => node.role), ['BECAUSE', 'BECAUSE'])
  const viaC = down.cites[0]!
  assert.equal(viaC.row.id, cId)
  assert.deepEqual(viaC.children.map(node => node.row.id).sort(), [aId, bId].sort())
  // The second citation of `a` is a re-statement without children.
  const repeated = down.cites[1]!
  assert.equal(repeated.row.id, aId)
  assert.equal(repeated.repeat, true)
  assert.deepEqual(repeated.children, [])
  const up = lineage(store, aId)!
  assert.equal(up.cites.length, 0)
  assert.ok(up.citedBy.some(node => node.row.id === cId))
  assert.ok(up.citedBy.some(node => node.row.id === dId))
  // Counts surface on the view so the page links only where lineage exists.
  assert.equal(down.row.cites, 2)
  assert.equal(up.row.citedBy, 2)
  assert.equal(lineage(store, 'no-such-id'), undefined)
  store.close()
})

test('lineage terminates on §24.5 support cycles', () => {
  const store = open()
  const result = store.ingest('x IS up @ 70%\ny IS up @ 70%', { source: 'test' })
  const [xId, yId] = result.ids as [string, string]
  store.appendEdges([
    { parentId: xId, role: 'BECAUSE', childId: yId },
    { parentId: yId, role: 'BECAUSE', childId: xId }
  ])
  const tree = lineage(store, xId)!
  assert.equal(tree.cites.length, 1)
  const cycled = tree.cites[0]!.children
  // y cites x back — the root is already seen, so the walk re-states and stops.
  assert.equal(cycled.length, 1)
  assert.equal(cycled[0]!.repeat, true)
  store.close()
})

test('lineage marks depth-capped nodes truncated, never as complete leaves', () => {
  const store = open()
  // A citation chain deeper than the render cap: step-19 cites step-18
  // cites … cites step-0.
  const chain = 20
  const ids = store.ingest(
    Array.from({ length: chain }, (_, i) => `step-${i} IS done`).join('\n'),
    { source: 'test' }
  ).ids
  store.appendEdges(Array.from({ length: chain - 1 }, (_, i) =>
    ({ parentId: ids[i + 1]!, role: 'BECAUSE' as const, childId: ids[i]! })))
  const down = lineage(store, ids[chain - 1]!)!
  // Walk to the deepest rendered node of the cites tree.
  let node = down.cites[0]!
  let rendered = 1
  while (node.children.length > 0) {
    node = node.children[0]!
    rendered += 1
  }
  // The chain outruns what rendered, so the walk was cut at a node that
  // still cites a premise — it must say so, not pose as a leaf.
  assert.ok(rendered < chain - 1)
  assert.equal(node.row.cites, 1)
  assert.equal(node.truncated, true)
  // The up walk is capped and marked the same way.
  const up = lineage(store, ids[0]!)!
  let dependent = up.citedBy[0]!
  while (dependent.children.length > 0) {
    dependent = dependent.children[0]!
  }
  assert.equal(dependent.row.citedBy, 1)
  assert.equal(dependent.truncated, true)
  // A genuine leaf — the chain's bottom reached within the cap — is unmarked.
  const shallow = lineage(store, ids[2]!)!
  let leaf = shallow.cites[0]!
  while (leaf.children.length > 0) {
    leaf = leaf.children[0]!
  }
  assert.equal(leaf.row.cites, 0)
  assert.equal(leaf.truncated, undefined)
  store.close()
})

test('search rides the store FTS, newest first', () => {
  const store = fixture()
  const matches = search(store, 'redis-cache')
  assert.ok(matches.length >= 1)
  assert.ok(matches.some(match => match.subject === 'api-gateway'))
  assert.deepEqual(search(store, 'nothing-matches-this'), [])
  store.close()
})
