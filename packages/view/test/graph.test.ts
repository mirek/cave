import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { open } from '@cavelang/store'
import { graph, names, page, serve } from '@cavelang/view'

const fixture = () => {
  const store = open()
  store.ingest(`
api-gateway IS service
api-gateway USES redis-cache @ 90%
api-gateway USES auth
auth USES postgres
postgres RUNS host-1
platform CONTAINS api-gateway
api-gateway HAS latency: 120 ms
auth USES "a literal"
gone USES api-gateway
gone USES api-gateway @ 0%
secret-system USES api-gateway #sensitivity:confidential
`)
  return store
}

test('graph neighborhoods walk current entity relations breadth-first both ways (spec §30.2)', () => {
  const store = fixture()
  try {
    const one = graph(store, { name: 'api-gateway' })
    assert.equal(one.focus, 'api-gateway')
    assert.deepEqual(one.nodes.map(node => [node.name, node.depth]), [
      ['api-gateway', 0], ['auth', 1], ['platform', 1], ['redis-cache', 1], ['service', 1]
    ])
    assert.deepEqual(one.nodes[0]!.types, ['service'])
    // Literals, attributes, retracted rows and hidden rows never become nodes or edges.
    for (const absent of ['"a literal"', 'gone', 'secret-system', 'postgres']) {
      assert.equal(one.nodes.some(node => node.name === absent), false, absent)
    }
    assert.deepEqual(one.edges.map(edge => `${edge.source} ${edge.verb} ${edge.target}`).sort(), [
      'api-gateway IS service', 'api-gateway USES auth', 'api-gateway USES redis-cache', 'platform CONTAINS api-gateway'
    ])
    assert.equal(one.edges.find(edge => edge.target === 'redis-cache')!.conf, 0.9)
    assert.equal(one.total, 5)
    const two = graph(store, { name: 'api-gateway', depth: 2 })
    assert.deepEqual(two.nodes.filter(node => node.depth === 2).map(node => node.name), ['postgres'])
    const three = graph(store, { name: 'api-gateway', depth: 3 })
    assert.ok(three.nodes.some(node => node.name === 'host-1' && node.depth === 3))
    // The cap keeps the focus and nearest names, and total reports what was cut.
    const capped = graph(store, { name: 'api-gateway', depth: 3, limit: 2 })
    assert.equal(capped.nodes.length, 2)
    assert.equal(capped.nodes[0]!.name, 'api-gateway')
    assert.equal(capped.total, 7)
    assert.ok(capped.edges.every(edge => capped.nodes.some(node => node.name === edge.source) &&
      capped.nodes.some(node => node.name === edge.target)))
    const wider = graph(store, { name: 'api-gateway', maxSensitivity: 'confidential' })
    assert.ok(wider.nodes.some(node => node.name === 'secret-system'))
  } finally { store.close() }
})

test('the store-wide graph ranks names by degree and validates its options', () => {
  const store = fixture()
  try {
    const map = graph(store)
    assert.equal(map.focus, undefined)
    assert.equal(map.nodes[0]!.name, 'api-gateway')
    assert.equal(map.nodes[0]!.degree, 4)
    assert.ok(map.nodes.every(node => node.depth === undefined))
    assert.equal(map.total, map.nodes.length)
    assert.equal(graph(store, { limit: 3 }).nodes.length, 3)
    assert.deepEqual(graph(store, { name: 'nobody' }).nodes.map(node => node.name), ['nobody'])
    for (const options of [{ depth: 0 }, { depth: 4 }, { depth: 1.5 }, { limit: 0 }, { name: '' }]) {
      assert.throws(() => graph(store, options as never), TypeError)
    }
  } finally { store.close() }
})

test('graph neighborhoods follow the alias closure only on request', () => {
  const store = open()
  try {
    store.ingest('svc ALIAS service-a\nservice-a USES db')
    assert.equal(graph(store, { name: 'svc' }).nodes.some(node => node.name === 'db'), false)
    const aliased = graph(store, { name: 'svc', aliases: true })
    assert.deepEqual(aliased.nodes.filter(node => node.depth === 0).map(node => node.name).sort(), ['service-a', 'svc'])
    assert.ok(aliased.nodes.some(node => node.name === 'db' && node.depth === 1))
  } finally { store.close() }
})

test('names offers matching entities, exact and prefix matches first', () => {
  const store = fixture()
  try {
    assert.deepEqual(names(store, 'AUTH'), ['auth'])
    assert.deepEqual(names(store, 'a').slice(0, 2), ['auth', 'api-gateway'])
    assert.deepEqual(names(store, 'gone'), [], 'names only from retracted rows are not offered')
    assert.deepEqual(names(store, 'secret'), [])
    assert.deepEqual(names(store, 'secret', { maxSensitivity: 'confidential' }), ['secret-system'])
    assert.deepEqual(names(store, 'literal'), [])
    assert.deepEqual(names(store, ''), [])
    assert.deepEqual(names(store, 'a', { limit: 1 }), ['auth'])
    assert.throws(() => names(store, 'a', { limit: -1 }), TypeError)
  } finally { store.close() }
})

test('HTTP graph and names endpoints validate parameters and keep the ceiling', async () => {
  const store = fixture()
  const handle = await serve(store, { port: 0 })
  try {
    const get = (path: string) => fetch(`${handle.url}api/${path}`)
    const map = await (await get('graph')).json() as { nodes: { name: string }[] }
    assert.equal(map.nodes.some(node => node.name === 'secret-system'), false)
    const near = await (await get('graph?name=api-gateway&depth=2&maxSensitivity=restricted')).json() as { focus: string, nodes: { name: string }[] }
    assert.equal(near.focus, 'api-gateway')
    assert.equal(near.nodes.some(node => node.name === 'secret-system'), false)
    for (const bad of ['graph?depth=0', 'graph?depth=4', 'graph?depth=x', 'graph?name=a&name=b', 'graph?depth=1&depth=2', 'graph?aliases=yes', 'names', 'names?q=', 'names?q=a&q=b', 'names?q=%00']) {
      assert.equal((await get(bad)).status, 400, bad)
    }
    assert.deepEqual(await (await get('names?q=auth')).json(), ['auth'])
    assert.deepEqual(await (await get('names?q=secret')).json(), [])
  } finally { await handle.close(); store.close() }
})

const script = page.slice(page.indexOf('<script>') + '<script>'.length, page.indexOf('</script>'))
const slice = (from: string, to: string): string => {
  const start = script.indexOf(from)
  const end = script.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `${from} … ${to}`)
  return script.slice(start, end)
}

test('claim rows lead with the statement and fold metadata behind a disclosure', () => {
  const claimHtml = runInNewContext(`var BACKTICK = '\\u0060'\n${slice('function esc (value)', '\nfunction section')}\nclaimHtml`) as
    (claim: Record<string, unknown>, options?: Record<string, unknown>) => string
  const html = claimHtml({
    subject: 'api', verb: 'USES', negated: false, object: 'db', conf: 0.9, importance: false, comment: 'checked',
    contexts: ['src:cli'], sources: [], tags: [{ key: 'team', value: 'edge' }], key: 'k', id: 'r1',
    at: '2026-09-08T10:11:12.000Z', cites: 1, citedBy: 0
  }, { self: 'api' })
  const [summary, meta] = html.split('</summary>') as [string, string]
  assert.match(html, /^<details class="claim">/)
  assert.match(summary, /<span class="self">api<\/span>/)
  assert.match(summary, /href="#\/e\/db"/)
  assert.match(summary, /@ 90%/)
  assert.match(summary, /note why …/)
  for (const hidden of ['src:cli', '#team', 'checked', 'history', 'lineage', '2026-09-08 10:11:12']) {
    assert.equal(summary.includes(hidden), false, hidden)
    assert.ok(meta.includes(hidden), hidden)
  }
  assert.match(claimHtml({
    subject: 'x', verb: 'IS', negated: false, object: 'y', conf: 1, importance: false,
    contexts: [], tags: [], key: 'k', id: 'r', at: '2026-09-08T00:00:00.000Z', cites: 0, citedBy: 0
  }, { rel: 'HAS-PART', note: '12d' }), /<span class="rel"[^>]*>HAS-PART<\/span> <span class="hint">12d<\/span>/)
})

test('graph layout is deterministic, finite and inside the frame', () => {
  const layout = runInNewContext(`${slice('function hashOf', '\nfunction radiusOf')}\nlayoutGraph`) as
    (data: unknown, width: number, height: number) => { x: number, y: number }[]
  const nodes = Array.from({ length: 30 }, (_, i) => ({ name: `n${i}`, degree: 1, types: [] }))
  const edges = nodes.slice(1).map((node, i) => ({ source: `n${Math.floor(i / 3)}`, target: node.name }))
  const data = { focus: 'n0', nodes, edges: [...edges, { source: 'n0', target: 'n0' }] }
  const first = layout(data, 900, 360)
  assert.deepEqual(layout(data, 900, 360), first)
  for (const point of first) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
    assert.ok(point.x >= 0 && point.x <= 900 && point.y >= 0 && point.y <= 360, JSON.stringify(point))
  }
  assert.deepEqual(layout({ nodes: [{ name: 'alone', degree: 0, types: [] }], edges: [] }, 400, 300).length, 1)
})

test('graph markup escapes hostile names and links every node to its entity 360', () => {
  const hostile = '<img src=x onerror=alert(1)>'
  const target = { clientWidth: 800, innerHTML: '', querySelector: () => null }
  const draw = runInNewContext(`${slice('function esc (value)', '\nfunction claimHtml')}
${slice('function plural', '\nfunction shapeProblem')}
${slice('function hashOf', '\nfunction wireGraph')}
function wireGraph () {}
drawGraph`, { window: { innerHeight: 900 }, BACKTICK: '`' }) as (target: unknown, data: unknown) => void
  draw(target, {
    focus: hostile,
    nodes: [{ name: hostile, degree: 1, types: ['<b>'] }, { name: 'db', degree: 1, types: [] }],
    edges: [{ source: hostile, target: 'db', verb: 'USES', negated: true, conf: 0.5 }]
  })
  assert.doesNotMatch(target.innerHTML, /<img|<b>/)
  assert.match(target.innerHTML, /href="#\/e\/%3Cimg%20src%3Dx%20onerror%3Dalert\(1\)%3E"/)
  assert.match(target.innerHTML, /href="#\/e\/db"/)
  assert.match(target.innerHTML, /class="ed neg"/)
  assert.match(target.innerHTML, /NOT USES 50%/)
  draw(target, { nodes: [], edges: [] })
  assert.match(target.innerHTML, /no relations between entities/)
})

test('graphs and the related index render entity names that match Object.prototype keys', () => {
  const target = { clientWidth: 800, innerHTML: '', querySelector: () => null }
  const draw = runInNewContext(`${slice('function esc (value)', '\nfunction claimHtml')}
${slice('function plural', '\nfunction shapeProblem')}
${slice('function hashOf', '\nfunction wireGraph')}
function wireGraph () {}
drawGraph`, { window: { innerHeight: 900 }, BACKTICK: '`' }) as (target: unknown, data: unknown) => void
  const nodes = ['api', '__proto__', 'constructor', 'toString'].map(name => ({ name, degree: 1, types: ['__proto__'] }))
  assert.doesNotThrow(() => draw(target, {
    focus: 'api', nodes,
    edges: nodes.slice(1).map(node => ({ source: 'api', target: node.name, verb: 'USES', negated: false, conf: 1 }))
  }))
  assert.match(target.innerHTML, /href="#\/e\/__proto__"/)
  assert.match(target.innerHTML, /<i class="c0"><\/i>__proto__/)
  const related = runInNewContext(`var BACKTICK = '\\u0060'
${slice('function esc (value)', '\nfunction claimHtml')}
function section (title, body) { return body }
${slice('function neighborsHtml', '\nfunction entityPage')}
neighborsHtml`) as (data: unknown) => string
  const html = related({
    name: 'api',
    out: [{ verb: '__proto__', negated: false, object: 'db', conf: 1 }, { verb: 'constructor', negated: false, object: 'x', conf: 1 }],
    in: []
  })
  assert.match(html, />__proto__ →</)
  assert.match(html, />constructor →</)
})

test('a superseded panel request cannot overwrite a newer one in the same view', async () => {
  const target = { innerHTML: '' }
  const view = { querySelector: () => target }
  const later = runInNewContext(`var navigation = 1\nvar esc = String\n${slice('var panelRequests', '\n/* Recently visited')}\nlater`, { view }) as
    (selector: string, promise: Promise<string>, render: (el: typeof target, data: string) => void) => void
  const pending: ((value: string) => void)[] = []
  const request = () => new Promise<string>(resolve => pending.push(resolve))
  const render = (el: typeof target, data: string) => { el.innerHTML = data }
  later('#egraph', request(), render)
  later('#egraph', request(), render)
  later('#other', request(), render)
  pending[1]!('depth 3')
  await new Promise(resolve => setImmediate(resolve))
  pending[0]!('depth 1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(target.innerHTML, 'depth 3')
  pending[2]!('independent panel')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(target.innerHTML, 'independent panel')
})

test('graph layout keeps hub neighbors apart and survives parallel relations', () => {
  const layout = runInNewContext(`${slice('function hashOf', '\nfunction radiusOf')}\nlayoutGraph`) as
    (data: unknown, width: number, height: number) => { x: number, y: number }[]
  const spread = (points: { x: number, y: number }[]): number => {
    let min = Infinity
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) min = Math.min(min, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y))
    }
    return min
  }
  for (const size of [30, 60]) {
    const nodes = Array.from({ length: size }, (_, i) => ({ name: `n${String(i).padStart(2, '0')}`, degree: 1, types: [] }))
    const edges = nodes.slice(1).map(node => ({ source: 'n00', target: node.name }))
    for (const focus of [undefined, 'n00']) {
      const points = layout({ focus, nodes, edges }, 900, 352)
      assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)))
      assert.ok(spread(points) >= 12, `hub of ${size} (focus ${focus}): nearest nodes ${spread(points).toFixed(1)}px apart`)
    }
  }
  const pair = [{ name: 'a', degree: 500, types: [] }, { name: 'b', degree: 500, types: [] }]
  const parallel = Array.from({ length: 500 }, () => ({ source: 'a', target: 'b' }))
  const points = layout({ nodes: pair, edges: parallel }, 900, 352)
  assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), JSON.stringify(points))
})

test('names fills its limit with entities even when verb tokens sort first', () => {
  const store = open()
  try {
    const verbs = Array.from({ length: 60 }, (_, i) => `A${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`)
    store.ingest(verbs.map(verb => `${verb} IS verb`).join('\n') + '\napi-gateway USES db\nanother-api USES db')
    assert.deepEqual(names(store, 'a', { limit: 1 }), ['another-api'])
    assert.deepEqual(names(store, 'a', { limit: 5 }).sort(), ['another-api', 'api-gateway'])
    assert.deepEqual(names(store, 'a'), names(store, 'a', { limit: 20 }))
  } finally { store.close() }
})

test('alias neighborhoods stay within the node limit and keep the focus first', () => {
  const store = open()
  try {
    store.ingest(Array.from({ length: 300 }, (_, i) => `root ALIAS member-${i}`).join('\n') + '\nmember-7 USES db')
    const near = graph(store, { name: 'root', aliases: true, maxSensitivity: 'restricted' })
    assert.equal(near.nodes.length, 60)
    assert.equal(near.nodes[0]!.name, 'root')
    assert.equal(near.total, 302)
    assert.ok(near.edges.every(edge => near.nodes.some(node => node.name === edge.source) &&
      near.nodes.some(node => node.name === edge.target)))
    assert.deepEqual(graph(store, { name: 'member-7', aliases: true, limit: 1 }).nodes.map(node => node.name), ['member-7'])
  } finally { store.close() }
})
