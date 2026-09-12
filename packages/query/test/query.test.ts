import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as assert from 'node:assert/strict'
import { open, type Store } from '@cavelang/store'
import { match, Pattern, query } from '@cavelang/query'

test('large metadata patterns require every context and exact flat or valued tag', () => {
  const store = open()
  try {
    const contexts = Array.from({ length: 1500 }, (_, i) => `scope-${i}`)
    const tags = Array.from({ length: 1500 }, (_, i) => i % 2 ? `tag-${i}:value` : `tag-${i}`)
    const metadata = contexts.map(value => `@${value}`).concat(tags.map(value => `#${value}`)).join(' ')
    assert.deepEqual(store.ingest(`complete IS service ${metadata}\nmissing IS service @scope-0 #tag-0`).problems, [])
    assert.deepEqual(query(store, `?x IS service ${metadata}`).map(row => row.bindings['x']), ['complete'])
    const pattern = Pattern.parse(`?x IS service ${metadata}`)
    assert.equal(match(store, { ...pattern, contexts: [...pattern.contexts, 'absent'] }).length, 0)
    assert.equal(match(store, { ...pattern, tags: [...pattern.tags, { key: 'absent' }] }).length, 0)
    assert.equal(match(store, { ...pattern, tags: [{ key: 'tag-1' }] }).length, 0)
    assert.equal(match(store, { ...pattern, tags: [{ key: 'tag-0', value: 'value' }] }).length, 0)
    assert.equal(match(store, { ...pattern, contexts: [...pattern.contexts, contexts[0]!] }).length, 1)
  } finally { store.close() }
})

test('small and JSON-bound metadata retain NUL suffixes and Unicode exactly', () => {
  const store = open()
  try {
    for (const suffix of ['\0tail', '😀', '\\slash']) {
      const context = `scope:${suffix}`, key = `tag${suffix}`, value = `value${suffix}`
      assert.deepEqual(store.ingest(`item IS service @${context} #${key}:${value}`).problems, [])
      for (const size of [1, 16, 17]) {
        const pattern = { ...Pattern.parse('?x IS service'),
          contexts: Array.from({ length: size }, () => context),
          tags: Array.from({ length: size }, () => ({ key, value })) }
        assert.equal(match(store, pattern).length, 1)
        assert.equal(match(store, { ...pattern, contexts: [...pattern.contexts, context + 'different'] }).length, 0)
        assert.equal(match(store, { ...pattern, tags: [...pattern.tags, { key, value: value + 'different' }] }).length, 0)
        assert.equal(match(store, { ...pattern, tags: [...pattern.tags, { key }] }).length, 0)
      }
    }
  } finally { store.close() }
})

test('malformed Unicode queries cannot match replacement characters', () => {
  const store = open()
  try {
    store.ingest('api HAS label: "bad�text"\napi IS service @scope:� #note:�\nface HAS label: "café 😀\0tail"')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const bad of ['\ud800', '\udc00']) {
      assert.throws(() => query(store, `?x HAS label: "bad${bad}text"`), /CAVE-Q line 1: unpaired UTF-16 surrogate/)
      for (const newline of ['\n', '\r\n']) {
        assert.throws(() => query(store, ['; heading', '', '?x IS service', `WHERE context = scope:${bad}`].join(newline)), /CAVE-Q line 4: unpaired UTF-16 surrogate/)
      }
      const pattern = Pattern.parse('?x HAS label: "bad�text"')
      assert.throws(() => match(store, { ...pattern, payload: { kind: 'attribute', attribute: 'label', value: { kind: 'term', text: `"bad${bad}text"` } } }), /CAVE-Q: unpaired UTF-16 surrogate/)
      const hidden = Object.defineProperty({ kind: 'term' as const }, 'text', { value: `"bad${bad}text"` }) as Pattern.Slot
      assert.throws(() => match(store, { ...pattern, payload: { kind: 'attribute', attribute: 'label', value: hidden } }), /CAVE-Q: unpaired UTF-16 surrogate/)
      assert.throws(() => match(store, { ...Pattern.parse('?x IS service'), contexts: [`scope:${bad}`] }), /CAVE-Q: unpaired UTF-16 surrogate/)
    }
    assert.equal(query(store, '?x HAS label: "bad�text"').length, 1)
    assert.equal(query(store, '?x HAS label: "café 😀\0tail"')[0]!.bindings['x'], 'face')
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('structured matches reject unnamed variables in every slot', () => {
  const store = open()
  try {
    store.ingest('api IS service\napi HAS count: 42')
    const relation = Pattern.parse('?entity ?verb ?object')
    const attribute = Pattern.parse('?entity HAS count: ?value')
    const unnamed = { kind: 'var' as const, name: '' }
    const patterns: Pattern.t[] = [
      { ...relation, subject: unnamed },
      { ...relation, verb: unnamed },
      { ...relation, payload: { kind: 'object', object: unnamed } },
      { ...attribute, payload: { kind: 'attribute', attribute: 'count', value: unnamed } },
      { ...Pattern.parse('?entity HAS count: 42'), subject: unnamed },
    ]
    for (const pattern of patterns) {
      assert.throws(() => match(store, pattern), /CAVE-Q: variable requires a name.*wildcard/)
    }
    assert.deepEqual(match(store, attribute)[0]!.bindings, { entity: 'api', value: '42' })
    assert.equal(match(store, Pattern.parse('_ IS service')).length, 1)
  } finally { store.close() }
})

test('structured matches use one captured value across numeric detection and compilation', () => {
  const store = open()
  try {
    store.ingest('good HAS label: "chosen"\nother HAS label: "changed"\ngood HAS score: 42\nother HAS score: 43')
    for (const [attribute, chosen, changed] of [['label', '"chosen"', '"changed"'], ['score', '42', '43']] as const) {
      let reads = 0
      const pattern: Pattern.t = {
        ...Pattern.parse(`?x HAS ${attribute}: ${chosen}`),
        payload: { kind: 'attribute', attribute, value: {
          kind: 'term', get text() { return ++reads === 1 ? chosen : changed },
        } },
      }
      assert.deepEqual(match(store, pattern).map(row => row.bindings['x']), ['good'])
      assert.equal(reads, 1)
    }
  } finally { store.close() }
})

test('ordinary query options retain one transaction boundary across registry and row reads', () => {
  const store = open()
  try {
    const before = store.ingest('api HAS label: before').ids[0]!
    const after = store.ingest('api HAS label: after').ids[0]!
    for (const structured of [false, true]) {
      let reads = 0
      const options = { get asOf() { return ++reads === 1 ? before : after } }
      const input = 'api HAS label: ?label'
      const found = structured ? match(store, Pattern.parse(input), options) : query(store, input, options)
      assert.deepEqual(found.map(row => row.bindings['label']), ['before'])
      assert.equal(reads, 1)
    }
    let limitReads = 0
    assert.equal(query(store, 'api HAS label: ?label', {
      all: true, get limit() { return ++limitReads === 1 ? 1 : 10 },
    }).length, 1)
    assert.equal(limitReads, 1)
  } finally { store.close() }
})

test('prototype-named variables remain own bindings in ordinary and transitive queries', () => {
  const store = open()
  try {
    store.ingest('api IS service\napi HAS owner: platform\napi USES db\ndb USES cache')
    for (const [pattern, values] of [
      ['?__proto__ IS service', ['api']],
      ['api HAS owner: ?__proto__', ['platform']],
      ['?__proto__ USES+ cache', ['api', 'db']],
      ['api USES+ ?__proto__', ['cache', 'db']]
    ] as const) {
      const matches = query(store, pattern)
      assert.deepEqual(matches.map(match => match.bindings['__proto__']).sort(), values)
      for (const match of matches) {
        assert.ok(Object.hasOwn(match.bindings, '__proto__'))
        assert.equal(Object.getPrototypeOf(match.bindings), Object.prototype)
        assert.deepEqual(JSON.parse(JSON.stringify(match.bindings)), match.bindings)
      }
    }
    assert.deepEqual(query(store, '?constructor USES ?toString')[0]!.bindings, { constructor: 'api', toString: 'db' })
  } finally { store.close() }
})

const fixture = (): Store => {
  const store = open()
  store.ingest([
    'auth/middleware USES jwt',
    'api/gateway USES jwt @production',
    'legacy/app USES sessions',
    'auth/middleware HAS bug: token-expiry #security',
    'billing HAS bug: rounding #billing',
    'memory-leak CAUSE app/crash @ 50%',
    'deadlock CAUSE app/crash @ 30%',
    'oom-killer CAUSE app/crash @ 20%',
    'terrier EXTENDS dog',
    'dog EXTENDS mammal',
    'mammal EXTENDS animal',
    'monorepo CONTAINS packages/api',
    'ChatGPT HAS weekly-users: 900M users/wk',
    'blog HAS weekly-users: 5K users/wk'
  ].join('\n'))
  return store
}

test('live and read-only query connections see vocabulary committed by another writer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-query-vocabulary-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  const reader = open(path)
  const readOnly = open(path, { access: 'read-only' })
  try {
    // Populate both readers' caches before the vocabulary exists.
    reader.registry(); readOnly.registry()
    writer.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES service', { strict: true })
    for (const store of [reader, readOnly]) {
      assert.equal(store.reverse('service')[0]!.rel, 'MANAGED-BY')
      assert.deepEqual(query(store, 'service MANAGED-BY ?owner').map(match => match.bindings['owner']), ['alice'])
      assert.equal(store.registry(), store.registry(), 'unchanged data reuses the registry cache')
    }
    writer.ingest('MANAGES RENAMED-TO OPERATES\nbob OPERATES other', { strict: true })
    for (const store of [reader, readOnly]) {
      assert.deepEqual(query(store, 'bob MANAGES ?service').map(match => match.bindings['service']), ['other'])
    }
  } finally { readOnly.close(); reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('?x USES jwt — all systems using jwt (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, '?x USES jwt')
  assert.deepEqual(matches.map(match => match.bindings['x']), ['auth/middleware', 'api/gateway'])
  assert.equal(matches[0]!.row?.verb, 'USES')
  store.close()
})

test('?x HAS bug: ?bug #security — scoped to tagged claims (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, '?x HAS bug: ?bug #security')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { x: 'auth/middleware', bug: 'token-expiry' })
  store.close()
})

test('confidence filter (spec §12.1: WHERE conf >= 0.7 → none; >= 0.3 → two)', () => {
  const store = fixture()
  assert.equal(query(store, '?cause CAUSE app/crash\n  WHERE conf >= 0.7').length, 0)
  const likely = query(store, '?cause CAUSE app/crash\n  WHERE conf >= 0.3')
  assert.deepEqual(likely.map(match => match.bindings['cause']), ['memory-leak', 'deadlock'])
  store.close()
})

test('?x ?verb ?y @production — all production facts (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, '?x ?verb ?y @production')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { x: 'api/gateway', verb: 'USES', y: 'jwt' })
  store.close()
})

test('transitive EXTENDS+ (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, 'terrier EXTENDS+ animal')
  assert.equal(matches.length, 1)
  const up = query(store, 'terrier EXTENDS+ ?ancestor')
  assert.deepEqual(
    up.map(match => match.bindings['ancestor']).sort(),
    ['animal', 'dog', 'mammal']
  )
  store.close()
})

test('transitive closure crosses the former 32-hop boundary without truncation', () => {
  const store = open()
  const hops = 80
  const node = (index: number): string => `chain/${index.toString().padStart(3, '0')}`
  store.ingest(Array.from({ length: hops }, (_, index) =>
    `${node(index)} REACHES ${node(index + 1)}`).join('\n'))

  assert.equal(query(store, `${node(0)} REACHES+ ${node(32)}`).length, 1, '32 hops')
  assert.equal(query(store, `${node(0)} REACHES+ ${node(33)}`).length, 1, '33 hops')
  assert.equal(query(store, `${node(0)} REACHES+ ${node(hops)}`).length, 1, 'long chain')
  assert.deepEqual(
    query(store, `${node(0)} REACHES+ ?destination`).map(match => match.bindings['destination']),
    Array.from({ length: hops }, (_, index) => node(index + 1)),
    'a partly bound traversal returns the complete ordered chain'
  )

  const supported = query(store, `${node(0)} REACHES+ ${node(hops)}`, { support: true })
  assert.equal(supported.length, 1)
  assert.equal(supported[0]!.rows?.length, hops, 'every edge on the long path remains visible as support')
  store.close()
})

test('transitive matches carry their supporting edge rows under support (spec §12.1)', () => {
  const store = fixture()
  const matches = query(store, 'terrier EXTENDS+ animal', { support: true })
  assert.equal(matches.length, 1)
  assert.equal(matches[0]!.row, undefined, 'still no single matched row')
  assert.deepEqual(
    matches[0]!.rows!.map(row => `${row.subject}->${row.object}`).sort(),
    ['dog->mammal', 'mammal->animal', 'terrier->dog']
  )

  // Edges off the path are not support: terrier->dog reaches, but never
  // supports, dog's own ancestry.
  const up = query(store, 'dog EXTENDS+ ?ancestor', { support: true })
  const mammal = up.find(match => match.bindings['ancestor'] === 'mammal')!
  assert.deepEqual(mammal.rows!.map(row => `${row.subject}->${row.object}`), ['dog->mammal'])

  assert.equal(query(store, 'terrier EXTENDS+ animal')[0]!.rows, undefined, 'off by default')
  store.close()
})

test('support composes with aliases: edges across alias links support the connection', () => {
  const store = open()
  store.ingest('terrier EXTENDS doggo\ndog EXTENDS animal\ndoggo ALIAS dog')
  const matches = query(store, 'terrier EXTENDS+ animal', { aliases: true, support: true })
  assert.equal(matches.length, 1)
  assert.deepEqual(
    matches[0]!.rows!.map(row => `${row.subject}->${row.object}`).sort(),
    ['dog->animal', 'terrier->doggo']
  )
  store.close()
})

test('inverse verbs compile to the same physical query (spec §12.1)', () => {
  const store = fixture()
  const inverse = query(store, '?x PART-OF monorepo')
  const forward = query(store, 'monorepo CONTAINS ?x')
  assert.deepEqual(inverse.map(match => match.bindings), forward.map(match => match.bindings))
  assert.deepEqual(inverse[0]!.bindings, { x: 'packages/api' })
  assert.equal(inverse[0]!.row?.verb, 'CONTAINS')
  store.close()
})

test('deprecated and preferred verb spellings query one history (spec §5.8)', () => {
  const store = open()
  const old = store.ingest('alice WORKS-AT acme @ 60%')
  const renamed = store.ingest('WORKS-AT RENAMED-TO EMPLOYED-BY')
  store.ingest('alice EMPLOYED-BY acme @ 90%')
  assert.equal(query(store, 'alice WORKS-AT acme').length, 1)
  assert.equal(query(store, 'alice EMPLOYED-BY acme').length, 1)
  assert.equal(query(store, 'alice EMPLOYED-BY acme')[0]!.row?.conf, 0.9)
  assert.equal(query(store, 'alice EMPLOYED-BY acme', { all: true }).length, 2)
  assert.equal(query(store, 'alice EMPLOYED-BY acme', { asOf: old.ids[0]! }).length, 0)
  assert.equal(query(store, 'alice EMPLOYED-BY acme', { asOf: renamed.ids[0]! }).length, 1)
  store.close()
})

test('transitive inverse: ?x PART-OF+ walks CONTAINS downward', () => {
  const store = open()
  store.ingest('org CONTAINS monorepo\nmonorepo CONTAINS packages/api')
  const matches = query(store, 'packages/api PART-OF+ ?container')
  assert.deepEqual(
    matches.map(match => match.bindings['container']).sort(),
    ['monorepo', 'org']
  )
  store.close()
})

test('value filter (spec §12.2: WHERE value > …)', () => {
  const store = fixture()
  const big = query(store, '?x HAS weekly-users: ?n\n  WHERE value > 100000000')
  assert.equal(big.length, 1)
  assert.deepEqual(big[0]!.bindings, { x: 'ChatGPT', n: '900M users/wk' })
  store.close()
})

test('queries run over supported current beliefs by default (spec §9.1, §9.3)', () => {
  const store = open()
  store.ingest('server IS compromised @ 60%')
  store.ingest('server IS compromised @ 0% ; retracted')
  assert.equal(query(store, 'server IS compromised').length, 0, 'retracted → no current support')
  const explicit = query(store, 'server IS compromised\n  WHERE conf <= 1')
  assert.equal(explicit.length, 1, 'explicit conf filter sees the retracted current row')
  assert.equal(explicit[0]!.row?.conf, 0)
  assert.equal(query(store, 'server IS compromised', { all: true }).length, 2)
  store.close()
})

test('NOT patterns match negated rows only (spec §5.6)', () => {
  const store = open()
  store.ingest('server IS NOT compromised @ 90% @src:forensics')
  assert.equal(query(store, 'server IS compromised').length, 0)
  const negated = query(store, 'server IS NOT compromised')
  assert.equal(negated.length, 1)
  store.close()
})

test('tx date filter (spec §12.2)', () => {
  const store = fixture()
  assert.equal(query(store, '?x USES jwt\n  WHERE tx > 2020-01-01').length, 2)
  assert.equal(query(store, '?x USES jwt\n  WHERE tx < 2020-01-01').length, 0)
  store.close()
})

test('repeated variable forces equality', () => {
  const store = open()
  store.ingest('a NEEDS a\nb NEEDS c')
  const matches = query(store, '?x NEEDS ?x')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0]!.bindings, { x: 'a' })
  store.close()
})

test('code literal terms in patterns', () => {
  const store = open()
  store.ingest('`<=` FIX token-expiry')
  const matches = query(store, '?fix FIX token-expiry')
  assert.deepEqual(matches[0]!.bindings, { fix: '`<=`' })
  store.close()
})

test('transitive patterns reject filters', () => {
  const store = fixture()
  assert.throws(() => query(store, 'terrier EXTENDS+ ?x\n  WHERE conf >= 0.5'), /transitive/)
  store.close()
})

test('?x EXTENDS+ ?x finds cycles only and cycle-safe closure terminates', () => {
  const acyclic = open()
  acyclic.ingest('a EXTENDS b\nb EXTENDS c')
  assert.deepEqual(query(acyclic, '?x EXTENDS+ ?x'), [])
  acyclic.close()
  const cyclic = open()
  cyclic.ingest('a EXTENDS b\nb EXTENDS a\nc EXTENDS d')
  assert.deepEqual(
    query(cyclic, '?x EXTENDS+ ?x').map(match => match.bindings['x']).sort(),
    ['a', 'b']
  )
  cyclic.close()
})

test('VERB and VERB+ agree on retracted edges (spec §9.3)', () => {
  const store = open()
  store.ingest('terrier EXTENDS dog')
  store.ingest('terrier EXTENDS dog @ 0% ; retracted')
  assert.equal(query(store, 'terrier EXTENDS dog').length, 0, 'no current support')
  assert.equal(query(store, 'terrier EXTENDS+ dog').length, 0)
  assert.equal(query(store, 'terrier EXTENDS dog\n  WHERE conf <= 0.5').length, 1, 'explicit conf filter opts back in')
  assert.equal(query(store, 'terrier EXTENDS dog', { all: true }).length, 2)
  store.close()
})

test('tx date filters use whole-day intervals (spec §12.2)', () => {
  const store = open()
  store.ingest('a USES jwt')
  const row = store.currentBeliefs()[0]!
  const instant = new Date(parseInt(row.tx.slice(0, 8) + row.tx.slice(9, 13), 16)).toISOString()
  const day = instant.slice(0, 10)
  assert.equal(query(store, `?x USES jwt\n  WHERE tx = ${day}`).length, 1, 'recorded that day')
  assert.equal(query(store, `?x USES jwt\n  WHERE tx <= ${day}`).length, 1, '<= includes the boundary day')
  assert.equal(query(store, `?x USES jwt\n  WHERE tx > ${day}`).length, 0, '> excludes the boundary day')
  assert.equal(query(store, `?x USES jwt\n  WHERE tx >= ${day}`).length, 1)
  assert.equal(query(store, `?x USES jwt\n  WHERE tx != ${day}`).length, 0)
  assert.equal(query(store, `?x USES jwt\n  WHERE tx = ${instant.slice(0, 19)}`).length, 1, 'a zoneless second is UTC')
  store.close()
})

test('bound date/number objects match metric rows', () => {
  const store = open()
  store.ingest('latency IS 30ms\ndeploy PRECEDES 2026-01-01')
  assert.equal(query(store, 'latency IS 30ms').length, 1)
  assert.equal(query(store, 'deploy PRECEDES 2026-01-01').length, 1)
  const inverse = query(store, '2026-01-01 FOLLOWS deploy')
  assert.equal(inverse.length, 1, 'inverse pattern reaches the same metric row')
  store.close()
})
