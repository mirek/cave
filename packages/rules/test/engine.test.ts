import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { Confidence } from '@cavelang/core'
import { emitClaim, Registry } from '@cavelang/canonical'
import { declareRules, derive, listRules, retractRule, ruleSubject } from '@cavelang/rules'

const claimCount = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

test('large context premises wake incrementally and retract lost support', () => {
  const store = open()
  try {
    const contexts = Array.from({ length: 1500 }, (_, i) => `@scope-${i}`).join(' ')
    assert.deepEqual(declareRules(store, `?x IS service ${contexts} => ?x IS monitored`).problems, [])
    store.ingest(`first IS service ${contexts}`)
    assert.equal(derive(store).appended, 1)
    assert.equal(derive(store).appended, 0)
    store.ingest('missing IS service @scope-0')
    assert.equal(derive(store).appended, 0)
    store.ingest(`second IS service ${contexts}`)
    assert.equal(derive(store).appended, 1)
    store.ingest(`first IS service ${contexts} @ 0%`)
    assert.equal(derive(store).retracted, 1)
    assert.deepEqual(query(store, '?x IS monitored').map(row => row.bindings['x']), ['second'])
  } finally { store.close() }
})

test('failed derivation bookkeeping rolls back conclusions and lineage before corrected retry', () => {
  for (const attribute of ['derive-watermark', 'derive-vocabulary']) {
    const store = open()
    try {
      declareRules(store, '?x IS service => ?x IS monitored')
      store.ingest('api IS service')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const edges = store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all()
      store.db.exec(`CREATE TRIGGER reject_bookkeeping BEFORE INSERT ON cave_claim
        WHEN NEW.attribute = '${attribute}' BEGIN SELECT RAISE(ABORT, 'bookkeeping rejected'); END`)
      assert.throws(() => derive(store), /bookkeeping rejected/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all(), edges)
      assert.equal(query(store, 'api IS monitored').length, 0)
      store.db.exec('DROP TRIGGER reject_bookkeeping')
      assert.equal(derive(store).appended, 1)
      const conclusion = query(store, 'api IS monitored')[0]!.row!
      assert.ok(store.edgesOf(conclusion.id).some(edge => edge.role === 'BECAUSE'))
      const completed = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(derive(store).appended, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), completed)
    } finally { store.close() }
  }
})

test('late derivation failure restores cascaded retractions and replacement conclusions', () => {
  const store = open()
  try {
    declareRules(store, '?x IS service => ?x IS monitored\n?x IS monitored => ?x IS observed')
    store.ingest('old IS service')
    assert.equal(derive(store).appended, 2)
    const original = ['old IS monitored', 'old IS observed'].map(text => query(store, text)[0]!.row!)
    const lineage = original.map(row => store.edgesOf(row.id))
    store.ingest('old IS service @ 0%\nnew IS service')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    store.db.exec(`CREATE TRIGGER reject_final_mark BEFORE INSERT ON cave_claim
      WHEN NEW.attribute = 'derive-watermark' BEGIN SELECT RAISE(ABORT, 'final mark rejected'); END`)
    assert.throws(() => derive(store), /final mark rejected/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    for (const [index, text] of ['old IS monitored', 'old IS observed'].entries()) {
      assert.equal(query(store, text)[0]!.row!.id, original[index]!.id)
      assert.deepEqual(store.edgesOf(original[index]!.id), lineage[index])
    }
    assert.equal(query(store, 'new IS monitored').length, 0)
    assert.equal(query(store, 'new IS observed').length, 0)
    store.db.exec('DROP TRIGGER reject_final_mark')
    const recovered = derive(store)
    assert.equal(recovered.complete, true)
    for (const kind of ['monitored', 'observed']) {
      assert.equal(query(store, `old IS ${kind}`).length, 0)
      assert.equal(query(store, `new IS ${kind}`).length, 1)
    }
    for (const [index, row] of original.entries()) assert.deepEqual(store.edgesOf(row.id), lineage[index])
    const completed = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(derive(store).appended, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), completed)
  } finally { store.close() }
})

test('caller transactions replace rules atomically and preserve prior history on rejected replacements', () => {
  const store = open()
  try {
    const old = declareRules(store, '?x IS service => ?x IS monitored').rules[0]!
    store.ingest('api IS service')
    derive(store)
    const prior = query(store, 'api IS monitored')[0]!.row!
    const edges = store.edgesOf(prior.id)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const replace = (text: string) => store.transaction(() => {
      const removed = retractRule(store, old.digest)
      if (!removed.ok) throw new Error('old rule not found')
      const declared = declareRules(store, text)
      if (declared.rules.length !== 1 || declared.problems.length > 0) throw new Error('replacement declaration rejected')
      const result = derive(store)
      if (!result.complete || result.problems.length > 0) throw new Error('replacement derivation failed')
      return result
    })
    for (const rejected of ['', '?x IS service => ?missing IS observed']) {
      assert.throws(() => replace(rejected), /replacement declaration rejected/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(query(store, 'api IS monitored')[0]!.row!.id, prior.id)
    assert.equal(replace('?x IS service => ?x IS observed').complete, true)
    assert.equal(listRules(store).length, 1)
    assert.equal(query(store, 'api IS monitored').length, 0)
    assert.equal(query(store, 'api IS observed').length, 1)
    assert.deepEqual(store.edgesOf(prior.id), edges)
    const completed = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(derive(store).appended, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), completed)
  } finally { store.close() }
})

test('derivation uses the confidence threshold accepted by validation', () => {
  const store = open()
  try {
    declareRules(store, '?x IS service => ?x IS monitored')
    store.ingest('api IS service @ 50%')
    let reads = 0
    const result = derive(store, { get minConf() { return ++reads === 1 ? 1 : 0 } })
    assert.equal(result.appended, 0)
    assert.equal(query(store, 'api IS monitored').length, 0)
    assert.equal(reads, 1)
    assert.equal(derive(store, { minConf: 0 }).appended, 1)
  } finally { store.close() }
})

test('derivation uses the pass limit accepted by validation', () => {
  const store = open()
  try {
    declareRules(store, '?x IS service => ?x IS monitored')
    store.ingest('api IS service')
    let reads = 0
    const result = derive(store, { get maxPasses() { return ++reads === 1 ? 1 : 0 } })
    assert.equal(result.appended, 1)
    assert.equal(query(store, 'api IS monitored').length, 1)
    assert.equal(reads, 1)
  } finally { store.close() }
})

test('prelude diagnostics retain original lines after declarations', () => {
  for (const newline of ['\n', '\r\n']) {
    const store = open()
    try {
      const lines = ['; heading', '?x IS service => ?x IS monitored', '', '; middle', 'broken HAS']
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const invalid = declareRules(store, lines.join(newline))
      assert.equal(invalid.declared, 0)
      assert.equal(invalid.prelude, 0)
      assert.deepEqual(invalid.problems.map(problem => problem.line), [5])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      lines[4] = 'thing IS service'
      const corrected = declareRules(store, lines.join(newline))
      assert.deepEqual(corrected.problems, [])
      assert.equal(corrected.declared, 1)
      const repeated = declareRules(store, lines.join(newline))
      assert.equal(repeated.unchanged, 1)
      assert.equal(repeated.prelude, 0)
    } finally { store.close() }
  }
})

test('quiet rules skip transaction-head scans but changed premises still advance support', t => {
  const store = open()
  try {
    store.ingest('item HAS input: old')
    declareRules(store, '?x HAS input: ?v => ?x HAS output: ?v')
    derive(store)
    const prepare = store.db.prepare.bind(store.db)
    let headReads = 0
    t.mock.method(store.db, 'prepare', (sql: string) => {
      if (sql === 'SELECT MAX(tx) AS t FROM cave_claim') headReads++
      return prepare(sql)
    })
    const before = store.exportText({ tx: true })
    derive(store)
    assert.equal(headReads, 0)
    assert.equal(store.exportText({ tx: true }), before)
    store.ingest('item HAS input: new')
    headReads = 0
    assert.equal(derive(store).updated, 1)
    assert.ok(headReads > 0)
    assert.deepEqual(query(store, 'item HAS output: ?v').map(match => match.bindings['v']), ['new'])
  } finally { store.close() }
})

test('settled rules reevaluate when alias matching changes, including after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cave-rule-options-'))
  const path = join(directory, 'rules.db')
  let store = open(path)
  try {
    store.ingest('postgres ALIAS postgresql\nbilling USES postgres\nanalytics USES postgresql')
    declareRules(store, '?x USES postgres => ?x NEEDS db-review')
    derive(store)
    const before = store.exportText({ tx: true })
    assert.equal(derive(store, { aliases: true, dryRun: true }).appended, 1)
    assert.equal(store.exportText({ tx: true }), before)
    assert.equal(derive(store, { aliases: true }).appended, 1)
    const settled = store.exportText({ tx: true })
    derive(store, { aliases: true })
    assert.equal(store.exportText({ tx: true }), settled)
    store.close()
    store = open(path)
    assert.equal(derive(store).retracted, 1)
    assert.deepEqual(query(store, '?x NEEDS db-review').map(match => match.bindings['x']), ['billing'])
    const exact = store.exportText({ tx: true })
    derive(store)
    assert.equal(store.exportText({ tx: true }), exact)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('settled rules reevaluate when the confidence floor changes', () => {
  const store = open()
  try {
    store.ingest('maybe IS candidate @ 1%')
    declareRules(store, '?x IS candidate => ?x IS selected')
    derive(store)
    assert.equal(derive(store, { minConf: 0.001 }).appended, 1)
    assert.equal(query(store, 'maybe IS selected')[0]!.row!.conf, 0.01)
    assert.equal(derive(store).retracted, 1)
    assert.equal(query(store, 'maybe IS selected').length, 0)
    const before = store.exportText({ tx: true })
    derive(store)
    assert.equal(store.exportText({ tx: true }), before)
  } finally { store.close() }
})

test('rule discovery does not materialize unrelated current beliefs', t => {
  const store = open()
  try {
    store.ingest(Array.from({ length: 1000 }, (_, i) => `item/${i} IS record`).join('\n'))
    store.ingest('rule/disabled HAS rule: `?x IS record => ?x IS reviewed`\nrule/disabled HAS rule: `?x IS record => ?x IS reviewed` @ 0%')
    t.mock.method(store, 'currentBeliefs', () => { throw new Error('materialized all current beliefs') })
    const result = derive(store)
    assert.equal(result.complete, true)
    assert.equal(result.rules.length, 0)
    assert.equal(result.appended, 0)
    store.ingest('rule/active HAS rule: `item/0 IS record => item/0 IS reviewed`')
    assert.equal(derive(store).appended, 1)
    assert.equal(derive(store).appended, 0)
  } finally { store.close() }
})

test('rule listing and retraction discover only current declaration rows', t => {
  const store = open()
  try {
    store.ingest(Array.from({ length: 1000 }, (_, i) => `item/${i} IS record`).join('\n'))
    store.ingest('rule/abcd1 HAS rule: `a IS record => a IS reviewed` @ctx:first\nrule/abcd2 HAS rule: `b IS record => b IS reviewed`')
    store.ingest('rule/abcd1 HAS rule: `a IS record => a IS accepted` @ctx:first')
    store.ingest('rule/disabled HAS rule: `c IS record => c IS reviewed`\nrule/disabled HAS rule: `c IS record => c IS reviewed` @ 0%')
    const expected = listRules(store)
    assert.deepEqual(expected.map(row => row.subject), ['rule/abcd2', 'rule/abcd1'])
    t.mock.method(store, 'currentBeliefs', () => { throw new Error('materialized all current beliefs') })
    assert.deepEqual(listRules(store), expected)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(retractRule(store, 'abcd').ok, false)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(retractRule(store, 'rule/abcd1').ok, true)
    assert.deepEqual(listRules(store).map(row => row.subject), ['rule/abcd2'])
    assert.equal(retractRule(store, 'rule/disabled').ok, false)
  } finally { store.close() }
})

test('invalid derivation limits reject before touching stored conclusions or watermarks', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareRules(store, '?x IS service => ?x IS reviewed')
    derive(store)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const minConf of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
      assert.throws(() => derive(store, { full: true, minConf }), /minConf.*finite.*0\.\.1/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    for (const maxPasses of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => derive(store, { full: true, maxPasses }), /maxPasses.*positive safe integer/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    for (const minConf of [0, 1]) {
      assert.equal(derive(store, { full: true, minConf, maxPasses: Number.MAX_SAFE_INTEGER }).complete, true)
    }
  } finally { store.close() }
})

test('prototype-named rule variables are unbound until matched', () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const store = open()
    try {
      store.ingest('api IS service\napi HAS owner: platform')
      assert.equal(declareRules(store, `?${name} IS service, ?${name} HAS owner: platform => ?${name} IS reviewed`).declared, 1)
      assert.equal(derive(store).appended, 1)
      assert.equal(query(store, 'api IS reviewed').length, 1)
      assert.equal(derive(store).appended, 0)
      store.ingest('api USES db')
      assert.equal(declareRules(store, `api ?${name} db => api IS linked`).declared, 1)
      assert.equal(derive(store).appended, 1)
      assert.equal(query(store, 'api IS linked').length, 1)
    } finally { store.close() }
  }
})

test('forward chaining derives the transitive closure with lineage (spec §24.2–§24.3)', () => {
  const store = open()
  store.ingest('a NEEDS b @ 80%\nb NEEDS c @ 90%\nc NEEDS d')
  const declaration = declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z ; transitive needs')
  assert.equal(declaration.declared, 1)
  assert.deepEqual(declaration.problems, [])
  const digest = declaration.rules[0]!.digest

  const report = derive(store)
  assert.equal(report.appended, 3, 'a→c, b→d, a→d')
  assert.equal(report.retracted, 0)
  assert.deepEqual(report.problems, [])

  // Noisy-AND confidence (spec §10.2 via @cavelang/fusion): 0.8 × 0.9 = 0.72.
  const derived = query(store, '?x NEEDS ?y @src:rule/' + digest)
  const byPair = new Map(derived.map(match => [`${match.bindings['x']}->${match.bindings['y']}`, match.row!]))
  assert.equal(byPair.get('a->c')!.conf, 0.8 * 0.9)
  assert.equal(byPair.get('b->d')!.conf, 0.9)
  // a→d: max over derivation paths — 0.8 × 0.9 either way.
  assert.equal(byPair.get('a->d')!.conf, 0.8 * 0.9)

  // Lineage (spec §24.3): BECAUSE at the specific premise rows, VIA at the rule.
  const edges = store.edgesOf(byPair.get('a->c')!.id)
  const because = edges.filter(edge => edge.role === 'BECAUSE').map(edge => edge.child.raw_line).sort()
  assert.deepEqual(because, ['a NEEDS b @ 80%', 'b NEEDS c @ 90%'])
  const via = edges.filter(edge => edge.role === 'VIA')
  assert.equal(via.length, 1)
  assert.equal(via[0]!.child.subject, ruleSubject(digest))
  store.close()
})

test('derivation cannot fire a rule revoked before its write reservation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-rule-race-'))
  const path = join(dir, 'knowledge.db')
  const store = open(path)
  const peer = open(path)
  try {
    store.ingest('a NEEDS b')
    const declaration = declareRules(store, '?x NEEDS ?y => ?x IS dependent')
    let crossed = false
    const intercepted = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return <T>(body: () => T): T => {
          if (!crossed) {
            crossed = true
            assert.equal(retractRule(peer, declaration.rules[0]!.digest).ok, true)
          }
          return target.transaction(body)
        }
      },
    })
    const report = derive(intercepted)
    assert.equal(crossed, true)
    assert.equal(report.appended, 0)
    assert.equal(query(store, 'a IS dependent').length, 0)
    assert.equal(report.rules.length, 0)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an already-open derivation store reads a peer writer\'s inverse vocabulary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-rule-vocabulary-'))
  const path = join(dir, 'knowledge.db')
  const store = open(path)
  const peer = open(path)
  try {
    peer.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES api')
    declareRules(peer, '?service MANAGED-BY alice => ?service IS managed')
    const report = derive(store)
    assert.equal(report.appended, 1)
    assert.equal(query(store, 'api IS managed').length, 1)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('re-runs are idempotent and watermark-incremental (spec §24.4)', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  const rows = claimCount(store)

  const again = derive(store)
  assert.equal(again.appended + again.updated + again.retracted, 0)
  assert.equal(again.rules[0]!.fired, false, 'watermark: nothing new, rule skipped')
  assert.equal(claimCount(store), rows, 'an idle run appends nothing — not even bookkeeping')

  // An unrelated append does not re-fire the rule…
  store.ingest('sky HAS color: blue')
  assert.equal(derive(store).rules[0]!.fired, false)
  // …but a premise-shaped one does.
  store.ingest('c NEEDS e')
  const refired = derive(store)
  assert.equal(refired.rules[0]!.fired, true)
  assert.ok(refired.appended >= 1)
  assert.equal(query(store, 'a NEEDS e').length, 1)
  store.close()
})

test('pass truncation preserves valid suspended conclusions and resumes safely', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c\nc NEEDS d\nd NEEDS e\ne NEEDS f')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  const initial = derive(store)
  assert.equal(initial.complete, true)
  const deepest = query(store, 'a NEEDS f')[0]!.row!
  const historyBefore = store.history(deepest.claim_key).length

  const full = derive(store, { full: true, maxPasses: 1 })
  assert.equal(full.complete, false)
  assert.equal(full.retracted, 0)
  assert.match(full.notes.join('\n'), /no unsupported conclusions were retracted/)
  assert.equal(query(store, 'a NEEDS f').length, 1, 'full truncation keeps a still-valid deep conclusion')
  assert.equal(store.history(deepest.claim_key).length, historyBefore, 'no transient @ 0% row was appended')

  store.ingest('f NEEDS g')
  const incremental = derive(store, { maxPasses: 1 })
  assert.equal(incremental.complete, false)
  assert.equal(incremental.retracted, 0)
  assert.equal(query(store, 'a NEEDS f').length, 1, 'incremental truncation also preserves prior support')

  const resumed = derive(store)
  assert.equal(resumed.complete, true)
  assert.equal(query(store, 'a NEEDS g').length, 1, 'an incomplete run did not advance its watermark')
  store.close()
})

for (const maxPasses of [1, 2]) for (const dryRun of [false, true]) {
  test(`pass exhaustion rolls back support reconciliation and permits retry (passes=${maxPasses}, dryRun=${dryRun})`, () => {
    const store = open()
    try {
      // Load the downstream rule first so reconciliation needs another pass
      // after withdrawing the upstream conclusion.
      declareRules(store, '?x IS enabled => ?x IS monitored')
      declareRules(store, '?x IS ready => ?x IS enabled')
      store.ingest('a IS ready')
      assert.equal(derive(store).complete, true)
      store.ingest('a IS ready @ 0%')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const report = derive(store, { maxPasses, dryRun })
      assert.equal(report.complete, false)
      assert.equal(report.retracted, 0)
      assert.ok(report.rules.every(rule => rule.retracted === 0))
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before,
        'incomplete reconciliation must retain history, lineage and watermarks')
      assert.equal(query(store, 'a IS enabled').length, 1)
      assert.equal(query(store, 'a IS monitored').length, 1)
      const retry = derive(store)
      assert.equal(retry.complete, true)
      assert.equal(retry.retracted, 2)
      assert.equal(query(store, 'a IS enabled').length, 0)
      assert.equal(query(store, 'a IS monitored').length, 0)
      const settled = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(derive(store).rules.some(rule => rule.fired), false)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), settled)
    } finally { store.close() }
  })
}

test('incomplete reconciliation retains earlier additions with accurate counts and lineage', () => {
  const store = open()
  try {
    declareRules(store, '?x IS enabled => ?x IS monitored')
    declareRules(store, '?x IS ready => ?x IS enabled')
    declareRules(store, '?x IS extra => ?x IS noted')
    store.ingest('a IS ready')
    derive(store)
    store.ingest('a IS ready @ 0%\nb IS extra')
    const marks = () => store.db.prepare(
      "SELECT * FROM cave_claim WHERE attribute IN ('derive-watermark', 'derive-vocabulary') ORDER BY id"
    ).all()
    const before = marks()
    const report = derive(store, { maxPasses: 2 })
    assert.equal(report.complete, false)
    assert.equal(report.appended, 1)
    assert.equal(report.updated, 0)
    assert.equal(report.retracted, 0)
    assert.deepEqual(marks(), before)
    const added = query(store, 'b IS noted')[0]!.row!
    assert.deepEqual(store.edgesOf(added.id).map(edge => edge.role).sort(), ['BECAUSE', 'VIA'])
    assert.equal(query(store, 'a IS enabled').length, 1)
    assert.equal(query(store, 'a IS monitored').length, 1)
    const retry = derive(store)
    assert.equal(retry.complete, true)
    assert.equal(retry.appended, 0)
    assert.equal(retry.retracted, 2)
    assert.equal(query(store, 'b IS noted')[0]!.row!.id, added.id)
  } finally { store.close() }
})

test('retracting a rule preserves RENAMED-TO vocabulary it derived (spec §5.8, §24.5)', () => {
  const store = open()
  store.ingest('schema HAS replacement: EMPLOYED-BY')
  const declaration = declareRules(store, 'schema HAS replacement: ?new => WORKS-AT RENAMED-TO ?new')
  derive(store)
  assert.equal(Registry.preferredOf(store.registry(), 'WORKS-AT'), 'EMPLOYED-BY')
  assert.ok(retractRule(store, declaration.rules[0]!.digest).ok)
  const lifecycle = store.currentBeliefs().find(row => row.verb === 'RENAMED-TO')
  assert.equal(lifecycle?.conf, 1)
  store.close()
})

test('a re-declared rule does not inherit its stale watermark (BUGS.md stale-rule-watermark, spec §24.4)', () => {
  const store = open()
  store.ingest('alpha IS server')
  const file = '?x IS server => ?x NEEDS monitoring'
  const declaration = declareRules(store, file)
  derive(store)
  assert.equal(query(store, 'alpha NEEDS monitoring').length, 1)

  // Retract the rule — its conclusions go with it (§24.5) — then declare
  // the identical text again: same digest, same watermark claim key, and
  // no premise-shaped row newer than the stored watermark.
  const retraction = retractRule(store, declaration.rules[0]!.digest)
  assert.ok(retraction.ok)
  assert.deepEqual(query(store, 'alpha NEEDS monitoring'), [])
  assert.equal(declareRules(store, file).declared, 1)

  const report = derive(store)
  assert.equal(report.rules[0]!.fired, true, 'the stale watermark must not skip the re-declared rule')
  assert.equal(query(store, 'alpha NEEDS monitoring').length, 1, 'conclusions re-derived from pre-watermark premises')

  const idle = derive(store)
  assert.equal(idle.rules[0]!.fired, false, 'the fresh watermark restores incrementality')
  store.close()
})

test('belief updates: premise confidence change re-derives the conclusion', () => {
  const store = open()
  store.ingest('monorepo CONTAINS api @ 80%')
  // Inverse premise and a rule confidence factor.
  declareRules(store, '?part PART-OF ?whole => ?part LIKE ?whole @ 50%')
  derive(store)
  assert.equal(query(store, 'api LIKE monorepo')[0]!.row!.conf, 0.4)

  store.ingest('monorepo CONTAINS api @ 60%')
  const report = derive(store)
  assert.equal(report.updated, 1)
  const series = query(store, 'api LIKE monorepo')
  assert.equal(series[0]!.row!.conf, 0.3)
  assert.equal(store.history(series[0]!.row!.claim_key).length, 2, 'append-only belief series')
  store.close()
})

test('premise retraction retracts dependents, cycles included (spec §24.5)', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS a')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  assert.ok(query(store, '?x NEEDS ?y').length > 2, 'cycle derived self-needs')

  store.ingest('a NEEDS b @ 0%\nb NEEDS a @ 0%')
  const report = derive(store)
  assert.ok(report.retracted >= 4, 'mutually-supporting derivations do not survive their sources')
  assert.equal(query(store, '?x NEEDS ?y').length, 0)
  store.close()
})

test('retraction cascades across rules', () => {
  const store = open()
  store.ingest('AT-RISK IS verb\na NEEDS b\nb IS flaky')
  declareRules(store, '?x NEEDS ?y, ?y IS flaky => ?x AT-RISK ?y')
  declareRules(store, '?x AT-RISK ?y => ?x NEEDS review')
  derive(store)
  assert.equal(query(store, 'a AT-RISK b').length, 1)
  assert.equal(query(store, 'a NEEDS review').length, 1)

  store.ingest('b IS flaky @ 0%')
  const report = derive(store)
  assert.equal(query(store, 'a AT-RISK b').length, 0)
  assert.equal(query(store, 'a NEEDS review').length, 0, 'second rule’s conclusion falls with the first’s')
  assert.equal(report.retracted, 2)
  store.close()
})

test('constraints filter bindings; conclusions below min-conf are not asserted', () => {
  const store = open()
  store.ingest('tom HAS age: 11\nann HAS age: 40\nsvc HAS load: 1500 req/s')
  declareRules(store, '?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian')
  declareRules(store, '?s HAS load: ?l, ?l > 1000 req/s => ?s NEEDS scaling')
  derive(store)
  assert.deepEqual(query(store, '?x NEEDS guardian').map(match => match.bindings['x']), ['tom'])
  assert.deepEqual(query(store, '?s NEEDS scaling').map(match => match.bindings['s']), ['svc'])

  store.ingest('maybe IS candidate @ 1%')
  declareRules(store, '?x IS candidate => ?x IS selected')
  const report = derive(store)
  assert.equal(query(store, 'maybe IS selected').length, 0, '1% is below the default 5% floor')
  assert.equal(report.appended, 0)
  const forced = derive(store, { minConf: 0.001, full: true })
  assert.ok(forced.appended >= 1)
  assert.equal(query(store, 'maybe IS selected')[0]!.row!.conf, 0.01)
  store.close()
})

test('NOT premises match explicitly negated claims, not absence', () => {
  const store = open()
  store.ingest('server IS NOT compromised @ 90%\nlaptop IS compromised')
  declareRules(store, '?x IS NOT compromised => ?x IS trusted')
  derive(store)
  assert.deepEqual(query(store, '?x IS trusted').map(match => match.bindings['x']), ['server'])
  store.close()
})

test('transitive premises bind endpoints without contributing rows or confidence', () => {
  const store = open()
  store.ingest('terrier EXTENDS dog @ 80%\ndog EXTENDS animal @ 80%\nrex IS terrier')
  declareRules(store, '?x IS ?t, ?t EXTENDS+ animal => ?x IS animal-kind')
  derive(store)
  const derived = query(store, 'rex IS animal-kind')
  assert.equal(derived.length, 1)
  // Only the IS premise carries a row; hops are structural (spec §24.2).
  assert.equal(derived[0]!.row!.conf, 1)
  const because = store.edgesOf(derived[0]!.row!.id).filter(edge => edge.role === 'BECAUSE')
  assert.equal(because.length, 1)
  assert.equal(because[0]!.child.raw_line, 'rex IS terrier')
  store.close()
})

test('inverse conclusions canonicalize to the primary direction — one key, either spelling', () => {
  const store = open()
  store.ingest('a USES b')
  declareRules(store, '?x USES ?y => ?y USED-BY ?x @ 60%')
  derive(store)
  const derived = query(store, '?x USES ?y \n WHERE conf <= 0.6')
  assert.equal(derived.length, 1)
  assert.equal(derived[0]!.row!.subject, 'a', 'stored in primary direction')
  assert.equal(derived[0]!.row!.verb, 'USES')
  store.close()
})

test('attribute and value-binding conclusions', () => {
  const store = open()
  store.ingest('api HAS latency: 30ms')
  declareRules(store, '?s HAS latency: ?l => ?s HAS observed-latency: ?l @ 90%')
  derive(store)
  const derived = query(store, '?s HAS observed-latency: ?l')
  assert.equal(derived.length, 1)
  assert.equal(derived[0]!.bindings['l'], '30ms')
  assert.equal(derived[0]!.row!.value_num, 30)
  assert.equal(derived[0]!.row!.value_unit, 'ms')
  store.close()
})

test('derived claims are actor-stamped and keep their own belief series (spec §9.5)', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c\na NEEDS c @ 30% ; hand-written belief about the same fact')
  const { rules } = declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  const all = query(store, 'a NEEDS ?y').filter(match => match.bindings['y'] === 'c')
  assert.equal(all.length, 2, 'the hand-written and the derived series coexist (§9.4)')
  const confs = all.map(match => match.row!.conf).sort()
  assert.deepEqual(confs, [0.3, 1])
  const stamped = all.find(match => match.row!.conf === 1)!
  assert.ok(stamped.row!.claim_key.includes(`src:rule/${rules[0]!.digest}`))
  store.close()
})

test('declaring is idempotent; prelude declares vocabulary once', () => {
  const store = open()
  const file = 'GRANDPARENT-OF IS verb\n?a PARENT-OF ?b, ?b PARENT-OF ?c => ?a GRANDPARENT-OF ?c'
  const first = declareRules(store, 'PARENT-OF IS verb\n' + file)
  assert.equal(first.declared, 1)
  assert.ok(first.prelude >= 2)
  const second = declareRules(store, 'PARENT-OF IS verb\n' + file)
  assert.equal(second.declared, 0)
  assert.equal(second.unchanged, 1)
  assert.equal(second.prelude, 0, 'unchanged prelude skipped by digest')
  assert.equal(listRules(store).length, 1)

  store.ingest('helena PARENT-OF jan\njan PARENT-OF maria')
  derive(store)
  assert.deepEqual(query(store, '?g GRANDPARENT-OF maria').map(match => match.bindings['g']), ['helena'])
  store.close()
})

test('retractRule retracts the declaration and everything it derived', () => {
  const store = open()
  store.ingest('x NEEDS y')
  const { rules } = declareRules(store, '?a NEEDS ?b => ?b NEEDED-BY ?a @ 90%')
  derive(store)
  assert.equal(query(store, '?a NEEDS ?b').length, 2)

  const outcome = retractRule(store, rules[0]!.digest.slice(0, 6))
  assert.ok(outcome.ok)
  assert.equal(outcome.ok && outcome.derived, 1)
  assert.equal(listRules(store).length, 0)
  assert.equal(query(store, '?a NEEDS ?b').length, 1, 'only the hand-written claim survives')

  assert.equal(retractRule(store, 'nonexistent').ok, false)
  store.close()
})

test('rule retraction includes declarations committed before its write reservation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-retract-race-'))
  const store = open(join(dir, 'knowledge.db'))
  const peer = open(join(dir, 'knowledge.db'))
  try {
    store.ingest('a NEEDS b')
    const text = '?x NEEDS ?y => ?x IS dependent'
    const { rules } = declareRules(store, text)
    derive(store)
    let crossed = false
    const intercepted = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return <T>(body: () => T): T => {
          if (!crossed) {
            crossed = true
            peer.ingest(`${ruleSubject(rules[0]!.digest)} HAS rule: \`${text}\` @reviewed`)
          }
          return target.transaction(body)
        }
      },
    })
    const result = retractRule(intercepted, rules[0]!.digest)
    assert.equal(crossed, true)
    assert.ok(result.ok)
    assert.equal(result.derived, 1)
    assert.equal(listRules(store).length, 0)
    assert.equal(derive(store).appended, 0)
    assert.equal(query(store, 'a IS dependent').length, 0)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rule retraction rechecks prefix ambiguity after reserving its write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-retract-prefix-'))
  const store = open(join(dir, 'knowledge.db'))
  const peer = open(join(dir, 'knowledge.db'))
  try {
    store.ingest('rule/abcd00000000 HAS rule: `?x NEEDS ?y => ?x IS dependent`')
    let crossed = false
    const intercepted = new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return <T>(body: () => T): T => {
          if (!crossed) {
            crossed = true
            peer.ingest('rule/abcd11111111 HAS rule: `?x NEEDS ?y => ?y IS needed`')
          }
          return target.transaction(body)
        }
      },
    })
    const result = retractRule(intercepted, 'abcd')
    assert.equal(crossed, true)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /ambiguous/)
    assert.equal(listRules(store).length, 2)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('dry-run reports without writing', () => {
  const store = open()
  store.ingest('a NEEDS b\nb NEEDS c')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  const before = claimCount(store)
  const dry = derive(store, { dryRun: true })
  assert.equal(dry.appended, 1)
  assert.equal(claimCount(store), before, 'nothing persisted')
  const real = derive(store)
  assert.equal(real.appended, 1)
  store.close()
})

test('unparseable stored rules are reported and skipped, others still fire', () => {
  const store = open()
  store.ingest('rule/broken HAS rule: `?x NEEDS => nonsense` @src:cave-derive')
  store.ingest('a NEEDS b\nb NEEDS c')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  const report = derive(store)
  assert.equal(report.problems.length, 1)
  assert.equal(report.problems[0]!.subject, 'rule/broken')
  assert.equal(report.appended, 1)
  store.close()
})

test('alias closure widens premise matching when opted in (spec §13.6)', () => {
  const store = open()
  store.ingest('postgres ALIAS postgresql\nbilling USES postgres\nanalytics USES postgresql')
  declareRules(store, '?x USES postgres => ?x NEEDS db-review')
  derive(store)
  assert.deepEqual(query(store, '?x NEEDS db-review').map(match => match.bindings['x']), ['billing'])
  derive(store, { aliases: true, full: true })
  assert.deepEqual(
    query(store, '?x NEEDS db-review').map(match => match.bindings['x']).sort(),
    ['analytics', 'billing']
  )
  store.close()
})

test('a conclusion naming its own @src: still carries the rule stamp — retraction propagates (BUGS.md src-stamp-bypass, spec §24.5)', () => {
  const store = open()
  store.ingest('a NEEDS b', { source: 'cli' })
  const declaration = declareRules(store, '?x NEEDS ?y => ?x LIKE ?y @src:mine')
  derive(store)
  assert.equal(query(store, 'a LIKE b').length, 1)
  assert.equal(store.byProvenance('run', `rule/${declaration.rules[0]!.digest}`).length > 0, true)
  // Retract the premise — the derivation must not outlive it.
  store.ingest('a NEEDS b @ 0%', { source: 'cli' })
  const report = derive(store)
  assert.equal(report.retracted, 1)
  assert.deepEqual(query(store, 'a LIKE b'), [])
  store.close()
})

test('--retract finds conclusions that name their own @src: (BUGS.md src-stamp-bypass, spec §24.5)', () => {
  const store = open()
  store.ingest('a NEEDS b')
  const declaration = declareRules(store, '?x NEEDS ?y => ?x LIKE ?y @src:mine')
  derive(store)
  const retraction = retractRule(store, declaration.rules[0]!.digest)
  assert.ok(retraction.ok && retraction.derived === 1, 'the derived claim is found and retracted')
  assert.deepEqual(query(store, 'a LIKE b'), [])
  store.close()
})

test('derived claims round-trip through export/import with lineage', () => {
  const store = open()
  store.ingest('a NEEDS b @ 80%\nb NEEDS c @ 90%')
  declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
  derive(store)
  const text = store.exportText()

  const restored = open()
  restored.ingest(text)
  const derived = query(restored, 'a NEEDS c')
  assert.equal(derived.length, 1)
  assert.equal(derived[0]!.row!.conf, 0.8 * 0.9)
  const roles = restored.edgesOf(derived[0]!.row!.id).map(edge => edge.role).sort()
  assert.deepEqual(roles, ['BECAUSE', 'BECAUSE', 'VIA'])
  restored.close()
  store.close()
})

test('incremental exact numeric premises observe equivalent spellings and their retractions', () => {
  const store = open()
  try {
    declareRules(store, '?site HAS users: 0.9B users/wk => ?site IS popular')
    assert.equal(derive(store).complete, true)
    assert.equal(derive(store).rules[0]!.fired, false)
    store.ingest('chat HAS users: 900M users/wk')
    assert.equal(query(store, 'chat HAS users: 0.9B users/wk').length, 1)
    const added = derive(store)
    assert.equal(added.rules[0]!.fired, true)
    assert.equal(query(store, 'chat IS popular').length, 1)
    store.ingest('chat HAS users: 900M users/wk @ 0%')
    const removed = derive(store)
    assert.equal(removed.retracted, 1)
    assert.equal(query(store, 'chat IS popular').length, 0)
    assert.equal(derive(store).rules[0]!.fired, false)
  } finally { store.close() }
})

test('incremental rules retract conclusions when values or tags stop matching', () => {
  for (const [premise, initial, replacement] of [
    ['?x HAS owner: team-a', 'api HAS owner: team-a', 'api HAS owner: team-b'],
    ['?x IS 30ms', 'latency IS 30ms', 'latency IS 40ms'],
    ['?x IS service #approved', 'api IS service #approved', 'api IS service #pending'],
    ['?x IS service #status:approved', 'api IS service #status:approved', 'api IS service #status:pending']
  ]) {
    const store = open()
    try {
      declareRules(store, `${premise} => ?x IS selected`)
      store.ingest(initial!)
      assert.equal(derive(store).appended, 1, premise)
      assert.equal(query(store, '?x IS selected').length, 1, premise)
      store.ingest(replacement!)
      assert.equal(derive(store).retracted, 1, premise)
      assert.equal(query(store, '?x IS selected').length, 0, premise)
      assert.equal(derive(store).rules[0]!.fired, false, premise)
    } finally { store.close() }
  }
})

test('new inverse vocabulary wakes a previously settled rule over old facts', () => {
  const store = open()
  try {
    store.ingest('MANAGES IS verb\nMANAGED-BY IS verb\nalice MANAGES api')
    declareRules(store, '?service MANAGED-BY alice => ?service IS managed')
    assert.equal(derive(store).appended, 0)
    assert.equal(derive(store).rules[0]!.fired, false)
    store.ingest('MANAGES REVERSE MANAGED-BY')
    assert.equal(query(store, 'api MANAGED-BY alice').length, 1)
    const result = derive(store)
    assert.equal(result.rules[0]!.fired, true)
    assert.equal(query(store, 'api IS managed').length, 1)
    assert.equal(derive(store).rules[0]!.fired, false)
  } finally { store.close() }
})


test('metadata-only vocabulary changes wake rules after reopen and preserve dry-run rollback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-rule-edge-'))
  const path = join(dir, 'rules.db')
  let store = open(path)
  try {
    const { ids } = store.ingest('MANAGES IS verb\nMANAGED-BY IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES api\nreview IS complete')
    declareRules(store, '?service MANAGED-BY alice => ?service IS managed')
    assert.equal(derive(store).appended, 1)
    assert.equal(derive(store).rules[0]!.fired, false)
    store.appendEdges([{ parentId: ids[4]!, role: 'WHEN', childId: ids[2]! }])
    assert.equal(query(store, 'api MANAGED-BY alice').length, 0)
    store.close()
    store = open(path)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(derive(store, { dryRun: true }).retracted, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(query(store, 'api IS managed').length, 1)
    assert.equal(derive(store).retracted, 1)
    assert.equal(query(store, 'api IS managed').length, 0)
    const settled = claimCount(store)
    assert.equal(derive(store).rules[0]!.fired, false)
    assert.equal(claimCount(store), settled)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})


test('vocabulary changed by derivation lineage invalidates earlier support in the same run', () => {
  const store = open()
  try {
    store.ingest('MANAGES IS verb\nMANAGED-BY IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES api')
    declareRules(store, '?service MANAGED-BY alice => ?service IS managed')
    declareRules(store, 'MANAGES REVERSE MANAGED-BY => review IS mapping')
    const result = derive(store)
    assert.equal(result.complete, true)
    assert.equal(query(store, 'api MANAGED-BY alice').length, 0)
    assert.equal(query(store, 'api IS managed').length, 0)
    assert.equal(derive(store).rules.every(rule => !rule.fired), true)
  } finally { store.close() }
})

test('legacy claim-only watermarks are reevaluated once and then remain quiet', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareRules(store, '?x IS service => ?x IS reviewed')
    derive(store)
    const mark = store.db.prepare("SELECT subject FROM cave_claim WHERE attribute = 'derive-watermark' LIMIT 1").get()!
    // A retracted fingerprint has the same migration behavior as absent legacy data.
    store.ingest(`${mark.subject} HAS derive-vocabulary: obsolete @src:cave-derive @ 0%`)
    assert.equal(derive(store).rules[0]!.fired, true)
    assert.equal(query(store, 'api IS reviewed').length, 1)
    const count = claimCount(store)
    assert.equal(derive(store).rules[0]!.fired, false)
    assert.equal(claimCount(store), count)
  } finally { store.close() }
})

test('derived confidence retains precision at the minimum-confidence boundary', () => {
  for (const [confidence, floor, expected] of [
    ['5.0049%', 0.050025, 0.050049],
    ['5.0051%', 0.050075, undefined],
    ['0.000001%', 0, 0.00000001]
  ] as const) {
    const store = open()
    try {
      store.ingest(`sensor IS source @ ${confidence}`)
      declareRules(store, '?x IS source => ?x IS derived')
      const result = derive(store, { minConf: floor })
      const rows = store.currentBeliefs().filter(row => row.subject === 'sensor' && row.object === 'derived')
      assert.equal(result.appended, expected === undefined ? 0 : 1)
      assert.deepEqual(rows.map(row => row.conf), expected === undefined ? [] : [expected])
      assert.equal(derive(store, { minConf: floor }).appended, 0)
    } finally { store.close() }
  }
})

test('small derived confidence revisions are not discarded by an absolute tolerance', () => {
  const store = open()
  try {
    declareRules(store, '?x IS source => ?x IS derived')
    store.ingest('sensor IS source @ 0.000001%')
    derive(store, { minConf: 0 })
    store.ingest('sensor IS source @ 0.000001001%')
    assert.equal(derive(store, { minConf: 0 }).updated, 1)
    const current = store.currentBeliefs().find(row => row.subject === 'sensor' && row.object === 'derived')!
    assert.equal(current.conf, 0.00000001001)
    assert.equal(derive(store, { minConf: 0 }).appended, 0)
  } finally { store.close() }
})

test('legacy rounded-confidence watermarks trigger reevaluation without new premises', () => {
  const store = open()
  try {
    store.ingest('sensor IS source @ 5.0049%')
    declareRules(store, '?x IS source => ?x IS derived')
    derive(store, { minConf: 0 })
    const derived = store.currentBeliefs().find(row => row.subject === 'sensor' && row.object === 'derived')!
    store.ingest(emitClaim({ ...store.toClaim(derived), conf: 0.05 }))
    const vocabulary = store.currentBeliefs().find(row => row.attribute === 'derive-vocabulary')!
    assert.ok(vocabulary.value_text!.startsWith('v3-'))
    store.ingest(vocabulary.raw_line.replace('v3-', 'v2-'))
    assert.equal(derive(store, { minConf: 0 }).updated, 1)
    assert.equal(store.currentBelief(derived.claim_key)!.conf, 0.050049)
    assert.equal(derive(store, { minConf: 0 }).updated, 0)
  } finally { store.close() }
})

test('zero-confidence conclusions settle and full reevaluation does not duplicate them', () => {
  for (const target of ['derived', 'source']) {
    const store = open()
    try {
      store.ingest('sensor IS source')
      const declaration = declareRules(store, `?x IS source => ?x IS ${target} @ 0%`)
      const subject = ruleSubject(declaration.rules[0]!.digest)
      const first = derive(store, { minConf: 0, maxPasses: 3 })
      assert.equal(first.complete, true)
      assert.equal(first.appended, 1)
      const conclusion = store.currentBeliefs().find(row =>
        row.subject === 'sensor' && row.object === target && row.conf === 0)!
      assert.ok(conclusion)
      assert.deepEqual(store.edgesOf(conclusion.id).map(edge => edge.role).sort(), ['BECAUSE', 'VIA'])
      for (const full of [false, true, true]) {
        const next = derive(store, { minConf: 0, maxPasses: 3, full })
        assert.equal(next.complete, true, `${target}, full=${full}`)
        assert.equal(next.appended, 0)
        assert.equal(next.updated, 0)
        assert.equal(store.history(conclusion.claim_key).length, 1)
      }
      assert.ok(store.currentBeliefs().some(row => row.subject === 'sensor' && row.object === 'source' && row.conf === 1))
      assert.ok(store.edgesOf(conclusion.id).some(edge => edge.role === 'VIA' && edge.child.subject === subject))
    } finally { store.close() }
  }
})

test('an underflowed conclusion can later reactivate at a positive confidence', () => {
  const store = open()
  try {
    store.ingest(`sensor IS source @ ${Confidence.formatExact(1e-30)}`)
    declareRules(store, `?x IS source => ?x IS derived @ ${Confidence.formatExact(1e-300)}`)
    assert.equal(derive(store, { minConf: 0 }).complete, true)
    const zero = store.currentBeliefs().find(row => row.subject === 'sensor' && row.object === 'derived')!
    assert.equal(zero.conf, 0)
    assert.equal(derive(store, { minConf: 0, full: true }).appended, 0)
    store.ingest('sensor IS source')
    const activated = derive(store, { minConf: 0 })
    assert.equal(activated.complete, true)
    assert.equal(activated.appended, 1)
    assert.equal(store.currentBelief(zero.claim_key)!.conf, 1e-300)
    assert.equal(store.history(zero.claim_key).length, 2)
  } finally { store.close() }
})

test('unchanged conclusions retain historical lineage while support follows current premise rows', () => {
  const store = open()
  try {
    const original = store.ingest('sensor HAS status: ready ; original observation').ids[0]!
    declareRules(store, '?x HAS status: ready => ?x IS enabled')
    derive(store)
    const conclusion = store.currentBeliefs().find(row => row.subject === 'sensor' && row.object === 'enabled')!
    const evidence = () => store.edgesOf(conclusion.id).filter(edge => edge.role === 'BECAUSE').map(edge => edge.child.id)
    assert.deepEqual(evidence(), [original])
    const replacement = store.ingest('sensor HAS status: ready ; revised observation').ids[0]!
    assert.notEqual(replacement, original)
    const refreshed = derive(store)
    assert.equal(refreshed.complete, true)
    assert.equal(refreshed.appended, 0)
    assert.equal(refreshed.updated, 0)
    assert.equal(store.currentBelief(conclusion.claim_key)!.id, conclusion.id)
    assert.deepEqual(evidence(), [original], 'lineage belongs to the original append')
    assert.equal(store.history(conclusion.claim_key).length, 1)
    store.ingest('sensor HAS status: blocked ; support ended')
    const withdrawn = derive(store)
    assert.equal(withdrawn.complete, true)
    assert.equal(withdrawn.retracted, 1)
    assert.equal(store.currentBelief(conclusion.claim_key)!.conf, 0)
    assert.equal(store.history(conclusion.claim_key).length, 2)
    assert.deepEqual(evidence(), [original], 'retraction does not rewrite historical evidence')
  } finally { store.close() }
})

test('partial rule declarations and rejected preludes recover without duplicating settled conclusions', () => {
  for (const newline of ['\n', '\r\n']) {
    const store = open()
    try {
      const source = 'sensor IS source'
      const enabled = '?x IS source => ?x IS enabled'
      const checked = '?x IS source => ?x IS checked'
      const first = declareRules(store, [source, '?x IS source => ?missing IS checked', enabled].join(newline))
      assert.equal(first.declared, 1)
      assert.equal(first.prelude, 1)
      assert.deepEqual(first.problems.map(problem => problem.line), [2])
      assert.equal(derive(store).appended, 1)
      const settled = store.currentBeliefs().find(row => row.subject === 'sensor' && row.object === 'enabled')!
      const corrected = declareRules(store, [source, checked, enabled].join(newline))
      assert.equal(corrected.declared, 1)
      assert.equal(corrected.unchanged, 1)
      assert.equal(corrected.prelude, 0)
      assert.deepEqual(corrected.problems, [])
      assert.equal(derive(store).appended, 1)
      assert.equal(store.currentBelief(settled.claim_key)!.id, settled.id)
      const repeated = declareRules(store, [source, checked, enabled].join(newline))
      assert.equal(repeated.declared, 0)
      assert.equal(repeated.unchanged, 2)
      assert.equal(repeated.prelude, 0)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const watched = '?x IS source => ?x IS watched'
      const rejected = declareRules(store, [source, 'broken HAS', watched].join(newline))
      assert.equal(rejected.declared, 0)
      assert.equal(rejected.prelude, 0)
      assert.deepEqual(rejected.problems.map(problem => problem.line), [2])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.equal(listRules(store).length, 2)
      const repaired = declareRules(store, [source, watched].join(newline))
      assert.equal(repaired.declared, 1)
      assert.equal(repaired.prelude, 0)
      assert.deepEqual(repaired.problems, [])
      assert.equal(derive(store).appended, 1)
      assert.equal(listRules(store).length, 3)
      assert.equal(store.history(settled.claim_key).length, 1)
      assert.deepEqual(store.currentBeliefs().filter(row => row.subject === 'sensor' && row.object !== 'source')
        .map(row => row.object).sort(), ['checked', 'enabled', 'watched'])
    } finally { store.close() }
  }
})


test('derived inverse vocabulary rolls back in previews and persists through lost support and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-derived-vocabulary-'))
  const path = join(dir, 'store.db')
  let store = open(path)
  try {
    const trigger = store.ingest('MANAGES IS verb\nMANAGED-BY IS verb\nalice MANAGES api\ntrigger EXISTS').ids.at(-1)!
    declareRules(store, '?service MANAGED-BY alice => ?service IS managed')
    const producer = declareRules(store, 'trigger EXISTS => MANAGES REVERSE MANAGED-BY').rules[0]!
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const preview = derive(store, { dryRun: true })
    assert.equal(preview.complete, true)
    assert.equal(preview.appended, 2)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(query(store, 'api MANAGED-BY alice').length, 0)
    const applied = derive(store)
    assert.equal(applied.complete, true)
    assert.equal(applied.appended, 2)
    assert.equal(query(store, 'api IS managed').length, 1)
    const inverse = store.currentBeliefs().find(row => row.verb === 'REVERSE')!
    assert.ok(store.edgesOf(inverse.id).some(edge => edge.role === 'BECAUSE' && edge.child.id === trigger))
    assert.equal(store.edgesOf(inverse.id).filter(edge => edge.role === 'VIA').length, 1)
    store.ingest('trigger EXISTS @ 0%')
    assert.equal(derive(store).retracted, 0)
    assert.equal(store.currentBelief(inverse.claim_key)!.id, inverse.id)
    assert.equal(query(store, 'api IS managed').length, 1)
    store.close()
    store = open(path)
    assert.equal(query(store, 'api MANAGED-BY alice').length, 1)
    assert.equal(derive(store, { full: true }).appended, 0)
    assert.equal(store.currentBelief(inverse.claim_key)!.id, inverse.id)
    assert.equal(query(store, 'api IS managed').length, 1)
    const retired = retractRule(store, producer.digest)
    assert.ok(retired.ok && retired.derived === 0)
    assert.equal(store.currentBelief(inverse.claim_key)!.id, inverse.id)
    assert.equal(query(store, 'api MANAGED-BY alice').length, 1)
    const settled = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(derive(store).rules.every(rule => !rule.fired), true)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), settled)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})


test('generated inverse declarations in one pass retain first-declaration-wins semantics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-derived-inverse-conflict-'))
  const path = join(dir, 'store.db')
  let store = open(path)
  try {
    store.ingest('CROSSES PROPOSES CROSSED-BY\nCROSSES PROPOSES TRAVERSED-BY\nriver CROSSES town')
    declareRules(store, '?verb PROPOSES ?inverse => ?verb REVERSE ?inverse')
    const result = derive(store)
    assert.ok(result.complete)
    assert.equal(result.appended, 2)
    assert.equal(query(store, 'town CROSSED-BY river').length, 1)
    assert.equal(query(store, 'town TRAVERSED-BY river').length, 0)
    store.close()
    store = open(path)
    assert.equal(query(store, 'town CROSSED-BY river').length, 1)
    assert.equal(query(store, 'town TRAVERSED-BY river').length, 0)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('binary stored rule bodies identify the claim and preserve derived history for repair', () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([61, 62])]) {
    const store = open()
    try {
      declareRules(store, '?x IS service => ?x IS monitored')
      store.ingest('older IS service')
      assert.equal(derive(store).appended, 1)
      store.ingest('newer IS service')
      const row = store.db.prepare("SELECT id, value_text FROM cave_claim WHERE attribute = 'rule'").get()!
      assert.equal(typeof row.id, 'string')
      assert.equal(typeof row.value_text, 'string')
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(bytes, row.id as string)
      const claims = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const edges = store.db.prepare('SELECT * FROM cave_edge ORDER BY parent_id, child_id, role').all()
      const expected = { name: 'TypeError', message: `stored rule field "rule" value_text must be text (claim ${JSON.stringify(row.id)})` }
      assert.throws(() => listRules(store), expected)
      assert.throws(() => derive(store), expected)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), claims)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY parent_id, child_id, role').all(), edges)
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(row.value_text as string, row.id as string)
      assert.equal(listRules(store)[0]?.ok, true)
      assert.equal(derive(store).appended, 1)
      assert.deepEqual(query(store, '?x IS monitored').map(match => match.bindings.x).sort(), ['newer', 'older'])
      const after = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      assert.equal(derive(store).appended, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), after)
    } finally { store.close() }
  }
})
