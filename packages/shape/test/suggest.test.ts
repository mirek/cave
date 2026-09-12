import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { judgePrompt, parseJudgeReply, suggestAliases, suggestTag, writeSuggestions } from '@cavelang/shape'

test('alias discovery reads current evidence and decision history in one snapshot', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-discovery-snapshot-'))
  const db = join(dir, 'knowledge.db')
  const writer = open(db)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('Long_Street EXISTS\nlong-street EXISTS')
  const reader = open(db, { access: 'read-only' })
  try {
    const expected = suggestAliases(reader)
    assert.equal(expected.length, 1)
    const prepare = reader.db.prepare.bind(reader.db)
    let injected = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      if (sql.startsWith('SELECT c.*')) {
        const all = statement.all.bind(statement)
        t.mock.method(statement, 'all', (...params: (string | number)[]) => {
          const rows = all(...params)
          if (!injected) {
            injected = true
            writer.ingest('Long_Street ALIAS NOT long-street')
          }
          return rows
        })
      }
      return statement
    })
    assert.deepEqual(suggestAliases(reader), expected)
    assert.equal(injected, true)
    assert.deepEqual(suggestAliases(reader), [])
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('discovery errors release snapshots and preserve caller rollback', t => {
  const store = open()
  try {
    store.ingest('Long_Street EXISTS\nlong-street EXISTS')
    const expected = suggestAliases(store)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const failure = new Error('decision history unavailable')
    const prepare = store.db.prepare.bind(store.db)
    let fail = true
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (fail && sql.includes('SELECT DISTINCT subject, object')) {
        fail = false
        throw failure
      }
      return prepare(sql)
    })
    assert.throws(() => suggestAliases(store), error => error === failure)
    store.db.exec('BEGIN')
    store.db.exec('ROLLBACK')
    const rollback = new Error('caller rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('Long_Street ALIAS NOT long-street')
      assert.deepEqual(suggestAliases(store), [])
      throw rollback
    }), error => error === rollback)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.deepEqual(suggestAliases(store), expected)
  } finally { store.close() }
})

test('discovery captures a programmatic result limit once', () => {
  const store = open()
  try {
    store.ingest('Long_Street EXISTS\nlong-street EXISTS\nmaria-smith EXISTS\nsmith-maria EXISTS')
    const expected = suggestAliases(store, { limit: 1 })
    assert.equal(suggestAliases(store).length, 2)
    let reads = 0
    const suggestions = suggestAliases(store, {
      get limit() { reads++; return reads === 1 ? 1 : undefined }
    })
    assert.deepEqual(suggestions, expected)
    assert.equal(reads, 1)
  } finally { store.close() }
})

test('pairs shared by multiple candidate groups are scored only once', () => {
  const store = open()
  try {
    store.ingest([
      'Long_Street HAS email: shared@example.org', 'long-street HAS email: shared@example.org',
      'Long_Street HAS phone: contact-phone', 'long-street HAS phone: contact-phone',
      'maria-smith EXISTS', 'smith-maria EXISTS'
    ].join('\n'))
    const suggestions = suggestAliases(store)
    assert.equal(suggestions.length, 2)
    assert.deepEqual(suggestions.map(suggestion => suggestion.signals.map(signal => signal.kind)),
      [['equal', 'value', 'value'], ['tokens']])
    assert.deepEqual(new Set(suggestions.map(suggestion => [suggestion.entity, suggestion.canonical].sort().join('\n'))),
      new Set(['Long_Street\nlong-street', 'maria-smith\nsmith-maria']))
    assert.deepEqual(suggestAliases(store, { limit: 1 }), suggestions.slice(0, 1))
  } finally { store.close() }
})

test('segment containment suggests drifted names in the review band (spec §27.2)', () => {
  const store = open()
  store.ingest([
    'jan PARENT-OF maria',
    'maria PARENT-OF anna',
    'grandma-maria HAS age: 90 yr'
  ].join('\n'))
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  const [suggestion] = suggestions
  // maria carries more current rows, so it is the canonical side.
  assert.equal(suggestion!.entity, 'grandma-maria')
  assert.equal(suggestion!.canonical, 'maria')
  assert.ok(suggestion!.confidence >= 0.3 && suggestion!.confidence <= 0.5)
  assert.ok(suggestion!.signals.some(signal => signal.kind === 'tokens'))
  assert.match(suggestion!.line, /^grandma-maria ALIAS maria #suggested @ \d+% ; /)
  store.close()
})

test('suggested lines round-trip through ingest with the tag intact (spec §27.3)', () => {
  const store = open()
  store.ingest('jan PARENT-OF maria\ngrandma-maria HAS age: 90 yr')
  const suggestions = suggestAliases(store)
  const { appended } = writeSuggestions(store, [...suggestions, ...suggestions])
  assert.equal(appended, 1)
  const rows = store.byTag(suggestTag)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.verb, 'ALIAS')
  const claim = store.toClaim(rows[0]!)
  assert.ok(claim.contexts.includes('src:suggest/alias'))
  assert.ok(claim.conf >= 0.3 && claim.conf <= 0.5)
  // The pair now has ALIAS history — a re-run suggests nothing (§27.1).
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('case and separator drift scores as normalized equality (spec §27.2)', () => {
  const store = open()
  store.ingest('Long-Street EXISTS\nlong_street EXISTS')
  const [suggestion] = suggestAliases(store)
  assert.ok(suggestion !== undefined)
  assert.equal(suggestion.score, 1)
  assert.equal(suggestion.confidence, 0.5)
  assert.ok(suggestion.signals.some(signal => signal.kind === 'equal'))
  store.close()
})

test('reordered segments score below equality, above containment (spec §27.2)', () => {
  const store = open()
  store.ingest('maria-grandma EXISTS\ngrandma-maria EXISTS')
  const [suggestion] = suggestAliases(store)
  assert.ok(suggestion !== undefined)
  assert.equal(suggestion.score, 0.9)
  store.close()
})

test('prefix similarity scores by length ratio (spec §27.2)', () => {
  const store = open()
  store.ingest('billing USES postgres\nanalytics USES postgresql')
  const suggestions = suggestAliases(store)
  const pair = suggestions.find(suggestion =>
    suggestion.entity === 'postgresql' || suggestion.canonical === 'postgresql')
  assert.ok(pair !== undefined)
  assert.ok(pair.signals.some(signal => signal.kind === 'prefix' && Math.abs(signal.score - 0.8) < 1e-9))
  store.close()
})

test('typos surface through edit similarity (spec §27.2)', () => {
  const store = open()
  store.ingest('analytics USES redis\nanlytics HAS owner: data-team')
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  assert.ok(suggestions[0]!.signals.some(signal => signal.kind === 'edit'))
  store.close()
})

test('leading-character typos reach edit scoring (spec §27.2)', () => {
  const store = open()
  store.ingest('billing USES postgres\nanalytics USES ostgres')
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  assert.deepEqual(
    [suggestions[0]!.entity, suggestions[0]!.canonical].sort(),
    ['ostgres', 'postgres']
  )
  assert.ok(suggestions[0]!.signals.some(signal => signal.kind === 'edit'))
  store.close()
})

test('a typo inside one segment is drift; a differing word is not (spec §27.2)', () => {
  const store = open()
  store.ingest('grandma-maria EXISTS\ngrandma-mria EXISTS')
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  assert.ok(suggestions[0]!.signals.some(signal => signal.kind === 'edit'))
  const siblings = open()
  siblings.ingest('north-tower EXISTS\nsouth-tower EXISTS')
  assert.equal(suggestAliases(siblings).length, 0)
  store.close()
  siblings.close()
})

test('names differing only in digits are versions, not drift (spec §27.2)', () => {
  const store = open()
  store.ingest('api-v1 EXISTS\napi-v2 EXISTS')
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('a rare shared textual value identifies; common and numeric values do not (spec §27.2)', () => {
  const store = open()
  store.ingest([
    'mrusin HAS orcid: 0000-0002-1825',
    'mirek-rusin HAS orcid: 0000-0002-1825',
    // Common category value — three carriers, never identifying.
    'mrusin HAS status: active',
    'mirek-rusin HAS status: active',
    'other HAS status: active',
    // Numeric value — two towers with the same height are not one tower;
    // and north/south is sibling naming, not spelling drift (§27.2).
    'north-tower HAS floors: 12',
    'south-tower HAS floors: 12'
  ].join('\n'))
  const suggestions = suggestAliases(store)
  assert.equal(suggestions.length, 1)
  const [suggestion] = suggestions
  assert.deepEqual([suggestion!.entity, suggestion!.canonical].sort(), ['mirek-rusin', 'mrusin'])
  assert.ok(suggestion!.signals.some(signal => signal.kind === 'value'))
  store.close()
})

test('rare shared values preserve structured attribute boundaries in evidence', () => {
  const store = open()
  try {
    // Simulate a historical row: new structured appends reject newline fields.
    store.ingest('alpha HAS identifier: contact-value\nzulu HAS identifier: contact-value')
    store.db.prepare('UPDATE cave_claim SET attribute = ? WHERE attribute = ?').run('identifier\nextra', 'identifier')
    const suggestions = suggestAliases(store)
    assert.equal(suggestions.length, 1)
    assert.deepEqual(suggestions[0]!.signals.filter(signal => signal.kind === 'value'), [
      { kind: 'value', score: 0.8, detail: 'share identifier\nextra: contact-value' }
    ])
  } finally { store.close() }
})

test('numeric trajectories do not generate rare textual alias evidence', () => {
  for (const value of ['10 -> 20 ms', '~10 -> 20 ms', '100 -> 400']) {
    const store = open()
    try {
      store.ingest(`alpha HAS measurement: ${value}\nzulu HAS measurement: ${value}`)
      assert.deepEqual(suggestAliases(store), [], value)
    } finally { store.close() }
  }
  const store = open()
  try {
    store.ingest('alpha HAS identifier: "10 -> 20 ms"\nzulu HAS identifier: "10 -> 20 ms"')
    assert.equal(suggestAliases(store).length, 1, 'quoted text remains textual evidence')
  } finally { store.close() }
})

test('rare-value evidence is capped per pair and refreshed when a third carrier appears', () => {
  const store = open()
  try {
    store.ingest([
      'mrusin HAS first: shared-first', 'mirek-rusin HAS first: shared-first',
      'mrusin HAS second: shared-second', 'mirek-rusin HAS second: shared-second',
      'mrusin HAS third: shared-third', 'mirek-rusin HAS third: shared-third'
    ].join('\n'), { strict: true })
    const before = suggestAliases(store)
    assert.equal(before.length, 1)
    assert.equal(before[0]!.signals.filter(signal => signal.kind === 'value').length, 2)
    store.ingest('other HAS first: shared-first\nother HAS second: shared-second', { strict: true })
    const after = suggestAliases(store)
    assert.equal(after.length, 1)
    assert.deepEqual(after[0]!.signals.filter(signal => signal.kind === 'value').map(signal => signal.detail),
      ['share third: shared-third'])
  } finally { store.close() }
})

test('shared-neighbor explanations preserve complete literal terms in both directions', () => {
  const store = open()
  try {
    store.ingest([
      'api-gateway USES "shared database engine"',
      'api_gateway USES "shared database engine"',
      '`shared deployment process` USES api-gateway',
      '`shared deployment process` USES api_gateway'
    ].join('\n'), { strict: true })
    const suggestions = suggestAliases(store)
    assert.equal(suggestions.length, 1)
    const suggestion = suggestions[0]!
    assert.deepEqual(suggestion.signals.filter(signal => signal.kind === 'neighbor').map(signal => signal.detail).sort(), [
      'both USES "shared database engine"',
      'both object of `shared deployment process` USES'
    ].sort())
    assert.ok(suggestion.line.includes('both USES "shared database engine"'))
    assert.ok(suggestion.line.includes('both object of `shared deployment process` USES'))
  } finally { store.close() }
})

test('shared neighbors boost but never generate (spec §27.2)', () => {
  const store = open()
  // Siblings share both parents — two shared inbound edges, no name or
  // value evidence: never suggested.
  store.ingest([
    'jan PARENT-OF maria',
    'helena PARENT-OF maria',
    'jan PARENT-OF piotr',
    'helena PARENT-OF piotr'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 0)
  // A borderline prefix pair (ratio 5/12 < 0.6) crosses the threshold
  // only with shared relations behind it.
  const drifted = open()
  drifted.ingest('auth-x USES redis\nauth-x IS service\nauth-xtra-line EXISTS')
  assert.equal(suggestAliases(drifted).length, 0)
  drifted.ingest('auth-xtra-line USES redis\nauth-xtra-line IS service')
  const suggestions = suggestAliases(drifted)
  assert.equal(suggestions.length, 1)
  assert.ok(suggestions[0]!.signals.filter(signal => signal.kind === 'neighbor').length === 2)
  store.close()
  drifted.close()
})

test('any recorded ALIAS history excludes the pair (spec §27.1)', () => {
  const merged = open()
  merged.ingest('maria EXISTS\ngrandma-maria EXISTS\ngrandma-maria ALIAS maria')
  assert.equal(suggestAliases(merged).length, 0)
  const rejected = open()
  rejected.ingest('maria EXISTS\ngrandma-maria EXISTS\ngrandma-maria ALIAS NOT maria')
  assert.equal(suggestAliases(rejected).length, 0)
  const unmerged = open()
  unmerged.ingest('maria EXISTS\ngrandma-maria EXISTS\ngrandma-maria ALIAS maria\ngrandma-maria ALIAS maria @ 0%')
  assert.equal(suggestAliases(unmerged).length, 0)
  merged.close()
  rejected.close()
  unmerged.close()
})

test('one closure group is one entity — members are never suggested (spec §27.1)', () => {
  const store = open()
  // maria–grandma-maria linked through babcia transitively, no direct row.
  store.ingest([
    'maria ALIAS babcia',
    'grandma-maria ALIAS babcia',
    'maria EXISTS',
    'grandma-maria EXISTS'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('related entities are distinct entities (spec §27.1)', () => {
  const store = open()
  store.ingest('auth-service CALLS auth-service-v2 ; deliberate split')
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('scope parents, system entities and literals are never candidates (spec §27.1)', () => {
  const store = open()
  store.ingest([
    'auth EXISTS',
    'auth/middleware EXISTS',
    'rule/ecf351a4f3e7 HAS rule: `?a PARENT-OF ?b => ?a ANCESTOR-OF ?b`',
    'rule/ecf351a4f3f8 HAS note: near-identical digest',
    'source/ingest HAS reliability: 80%',
    'source/ingest2 HAS reliability: 70%',
    'docs/readme.md HAS ingest-digest: 93a01c626b3f',
    'docs/readme2.md HAS ingest-digest: 93a01c626b40',
    'thing HAS quote: "some words"'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 0)
  store.close()
})

test('limited discovery preserves complete ranking across dense score ties', () => {
  const store = open()
  try {
    const names = Array.from({ length: 64 }, (_, bits) =>
      [...'abcdefg'].map((letter, i) => i === 0 ? letter : `${bits & (1 << (i - 1)) ? '-' : '_'}${letter}`).join(''))
    store.ingest([...names.map(name => `${name} EXISTS`),
      'maria EXISTS', 'grandma-maria EXISTS',
      'alpha HAS email: shared@example.org', 'omega HAS email: shared@example.org'
    ].join('\n'))
    const all = suggestAliases(store)
    assert.ok(all.length >= 2016)
    for (const limit of [1, 2, 7, 20, 100, all.length, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(suggestAliases(store, { limit }), all.slice(0, limit))
    }
  } finally { store.close() }
})

test('limited discovery preserves stable order for collation-equivalent names', () => {
  const store = open()
  try {
    const names = ['cafétówer', 'cafe\u0301tówer', 'caféto\u0301wer', 'cafe\u0301to\u0301wer']
    const lines = names.flatMap(name => [`${name} USES first-anchor`, `${name} USES second-anchor`])
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      lines.push(`${names[i]} HAS id-${i}-${j}: identity-${i}-${j}`, `${names[j]} HAS id-${i}-${j}: identity-${i}-${j}`)
    }
    store.ingest(lines.join('\n'))
    const all = suggestAliases(store)
    assert.equal(all.length, 6)
    for (const suggestion of all) {
      assert.equal(suggestion.score, 1)
      assert.equal(suggestion.entity.localeCompare(all[0]!.entity), 0)
      assert.equal(suggestion.canonical.localeCompare(all[0]!.canonical), 0)
    }
    for (const limit of [1, 2, 3, 5]) assert.deepEqual(suggestAliases(store, { limit }), all.slice(0, limit))
  } finally { store.close() }
})

test('minScore and limit narrow the result (spec §27.2)', () => {
  const store = open()
  store.ingest([
    'maria EXISTS',
    'grandma-maria EXISTS ; containment 0.7',
    'long-street EXISTS',
    'Long_Street EXISTS ; equality 1.0'
  ].join('\n'))
  assert.equal(suggestAliases(store).length, 2)
  const strong = suggestAliases(store, { minScore: 0.8 })
  assert.equal(strong.length, 1)
  assert.equal(strong[0]!.score, 1)
  assert.equal(suggestAliases(store, { limit: 1 }).length, 1)
  // Strongest first.
  assert.equal(suggestAliases(store)[0]!.score, 1)
  store.close()
})

test('judge evidence uses one snapshot across both sides of a suggestion', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-judge-snapshot-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('maria HAS city: Bern\ngrandma-maria HAS city: Bern')
  const reader = open(path, { access: 'read-only' })
  try {
    const suggestions = suggestAliases(reader)
    assert.equal(suggestions.length, 1)
    const expected = judgePrompt(reader, suggestions)
    const prepare = reader.db.prepare.bind(reader.db)
    let injected = false
    t.mock.method(reader.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      if (sql.includes('SELECT c.raw_line AS line')) {
        const all = statement.all.bind(statement)
        t.mock.method(statement, 'all', (...params: (string | number)[]) => {
          const rows = all(...params)
          if (!injected) {
            injected = true
            writer.ingest('maria HAS city: Zurich\ngrandma-maria HAS city: Zurich')
          }
          return rows
        })
      }
      return statement
    })
    assert.equal(judgePrompt(reader, suggestions), expected)
    assert.equal(injected, true)
    const next = judgePrompt(reader, suggestions)
    assert.match(next, /maria HAS city: Zurich/)
    assert.match(next, /grandma-maria HAS city: Zurich/)
    assert.doesNotMatch(next, /HAS city: Bern/)
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('judge read errors release the snapshot and preserve caller rollback', t => {
  const store = open()
  try {
    store.ingest('maria HAS city: Bern\ngrandma-maria HAS city: Bern')
    const suggestions = suggestAliases(store)
    const expected = judgePrompt(store, suggestions)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const prepare = store.db.prepare.bind(store.db)
    const failure = new Error('evidence unavailable')
    let fail = true
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (fail && sql.includes('SELECT c.raw_line AS line')) {
        fail = false
        throw failure
      }
      return prepare(sql)
    })
    assert.throws(() => judgePrompt(store, suggestions), error => error === failure)
    const rollback = new Error('caller rollback')
    assert.throws(() => store.transaction(() => {
      store.ingest('maria HAS city: Zurich\ngrandma-maria HAS city: Zurich')
      assert.match(judgePrompt(store, suggestions), /HAS city: Zurich/)
      throw rollback
    }), error => error === rollback)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(judgePrompt(store, suggestions), expected)
  } finally { store.close() }
})

test('an empty judge prompt does not access the store', t => {
  const store = open()
  try {
    t.mock.method(store.db, 'exec', () => { throw new Error('unexpected database access') })
    t.mock.method(store.db, 'prepare', () => { throw new Error('unexpected database access') })
    assert.match(judgePrompt(store, []), /Reply \[\] when none are/)
  } finally { store.close() }
})

test('judge prompt carries each side of the evidence (spec §27.4)', () => {
  const store = open()
  store.ingest('jan PARENT-OF maria\ngrandma-maria HAS age: 90 yr')
  const suggestions = suggestAliases(store)
  const prompt = judgePrompt(store, suggestions)
  assert.match(prompt, /S1: grandma-maria ALIAS maria #suggested/)
  assert.match(prompt, /jan PARENT-OF maria/)
  assert.match(prompt, /grandma-maria HAS age: 90 yr/)
  assert.match(prompt, /JSON array/)
  store.close()
})

test('judge replies parse leniently (spec §27.4)', () => {
  assert.deepEqual(parseJudgeReply('[1, 3]', 3), [0, 2])
  assert.deepEqual(parseJudgeReply('Looking at [the evidence] carefully... final answer: [2]', 3), [1])
  assert.deepEqual(parseJudgeReply('[]', 3), [])
  assert.deepEqual(parseJudgeReply('none of them match', 3), [])
  // Out-of-range, duplicate and non-integer entries drop.
  assert.deepEqual(parseJudgeReply('[0, 1, 1, 2.5, 9]', 3), [0])
})

test('judge replies never promote quoted or nested entries into confirmations', () => {
  assert.deepEqual(parseJudgeReply('["[1]"]', 3), [])
  assert.deepEqual(parseJudgeReply('[1, "[2]"]', 3), [0])
  assert.deepEqual(parseJudgeReply('[[1], 2]', 3), [1])
  assert.deepEqual(parseJudgeReply(JSON.stringify(['quoted " [2]', 1]), 3), [0])
  assert.deepEqual(parseJudgeReply(JSON.stringify(['backslash \\', 3]), 3), [2])
  assert.deepEqual(parseJudgeReply('[1] then ["not ] an answer", 3]', 3), [2])
  assert.deepEqual(parseJudgeReply('[1] then ["[2]"]', 3), [])
  assert.deepEqual(parseJudgeReply('unfinished [prose then [2]', 3), [1])
  assert.deepEqual(parseJudgeReply('unfinished ["quote then [2]', 3), [1])
})

test('discovery rejects malformed score and limit options before reading the store', () => {
  const store = open()
  store.close()
  for (const minScore of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
    assert.throws(() => suggestAliases(store, { minScore }), /minScore must be finite and between 0 and 1/)
  }
  for (const limit of [NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => suggestAliases(store, { limit }), /limit must be a positive safe integer/)
  }
})

test('writing retained suggestions never revives a reviewed pair', () => {
  const store = open()
  try {
    store.ingest('maria EXISTS\ngrandma-maria EXISTS')
    const suggestions = suggestAliases(store)
    assert.equal(writeSuggestions(store, suggestions).appended, 1)
    const suggestion = suggestions[0]!
    store.ingest(`${suggestion.entity} ALIAS ${suggestion.canonical} @src:suggest/alias @ 0%`)
    assert.equal(writeSuggestions(store, suggestions).appended, 0)
    const latest = store.db.prepare("SELECT conf FROM cave_claim WHERE verb = 'ALIAS' ORDER BY tx DESC LIMIT 1").get() as { conf: number }
    assert.equal(latest.conf, 0, 'the review remains the latest alias belief')
  } finally { store.close() }
})

test('suggestion writes observe reverse-direction reviews committed before reservation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-suggest-race-'))
  const path = join(dir, 'knowledge.db')
  const store = open(path)
  const peer = open(path)
  try {
    store.ingest('maria EXISTS\ngrandma-maria EXISTS')
    const suggestions = suggestAliases(store)
    const suggestion = suggestions[0]!
    let crossed = false
    const intercepted = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return <T>(body: () => T): T => {
          if (!crossed) {
            crossed = true
            peer.ingest(`${suggestion.canonical} ALIAS NOT ${suggestion.entity}`)
          }
          return target.transaction(body)
        }
      }
    })
    assert.equal(writeSuggestions(intercepted, suggestions).appended, 0)
    assert.equal(crossed, true)
    assert.equal(store.byTag(suggestTag).length, 0)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
