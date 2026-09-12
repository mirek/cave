import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { Registry } from '@cavelang/canonical'
import { act, actProposal, currentHook, declareActions, listActions, loadAction, retractAction, shellQuote } from '@cavelang/act'

test('action listings retain matching bodies, parameter docs and hooks during updates', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-action-list-'))
  const db = join(dir, 'knowledge.db')
  const writer = open(db)
  writer.db.exec('PRAGMA journal_mode = WAL')
  writer.ingest('action/review HAS action: `?service => ?service IS reviewed`\naction/review/service IS param ; old docs\naction/review HAS hook: old-hook')
  const reader = open(db, { access: 'read-only' })
  try {
    const expected = listActions(reader)
    assert.equal(expected.length, 1)
    const current = reader.currentBeliefs.bind(reader)
    let reads = 0
    t.mock.method(reader, 'currentBeliefs', () => {
      const rows = current()
      if (++reads === 1) {
        writer.ingest('action/review HAS action: `?service => ?service IS approved`\naction/review/service IS param ; new docs\naction/review HAS hook: new-hook')
      }
      return rows
    })
    assert.deepEqual(listActions(reader), expected)
    assert.equal(reads, 1)
    const next = listActions(reader)
    assert.match(next[0]!.text, /approved/)
    assert.equal(next[0]!.params[0]!.doc, 'new docs')
    assert.equal(next[0]!.hook, 'new-hook')
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('prelude diagnostics retain original lines after declarations', () => {
  for (const newline of ['\n', '\r\n']) {
    const store = open()
    try {
      const lines = ['; heading', 'action/review HAS action: `?service => ?service IS reviewed`', '', '; middle', 'broken HAS']
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const invalid = declareActions(store, lines.join(newline))
      assert.equal(invalid.declared, 0)
      assert.equal(invalid.prelude, 0)
      assert.deepEqual(invalid.problems.map(problem => problem.line), [5])
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      lines[4] = 'thing IS service'
      const corrected = declareActions(store, lines.join(newline))
      assert.deepEqual(corrected.problems, [])
      assert.equal(corrected.declared, 1)
      const repeated = declareActions(store, lines.join(newline))
      assert.equal(repeated.unchanged, 1)
      assert.equal(repeated.prelude, 0)
    } finally { store.close() }
  }
})

test('prototype-named action parameters require own arguments and preserve their bindings', () => {
  for (const name of ['constructor', 'toString']) {
    const store = open()
    try {
      assert.equal(declareActions(store, `action/review HAS action: \`?${name} => ?${name} IS reviewed\``).declared, 1)
      assert.equal(act(store, 'review', {}).ok, false)
      assert.equal(act(store, 'review', Object.create({ [name]: 'api' })).ok, false)
      assert.equal(query(store, 'api IS reviewed').length, 0)
      const result = act(store, 'review', { [name]: 'api' })
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(query(store, 'api IS reviewed').length, 1)
    } finally { store.close() }
  }
})

test('hooks use the same own parameter values that were validated for effects', () => {
  for (const enumerable of [true, false]) {
    const store = open()
    try {
      declareActions(store, 'action/review HAS action: `?service => ?service IS reviewed`\naction/review HAS hook: notify')
      let reads = 0
      const args = Object.defineProperty({}, 'service', {
        enumerable,
        get: () => ++reads === 1 ? 'api' : 'other'
      })
      const report = act(store, 'review', args, {
        hooks: { notify: 'node -e "process.stdout.write(process.argv[1])" {service}' }
      })
      assert.ok(report.ok)
      assert.equal(report.hook?.output, 'api')
      assert.equal(report.hook?.error, undefined)
      assert.equal(reads, 1)
      assert.equal(query(store, 'api IS reviewed').length, 1)
      assert.equal(query(store, 'other IS reviewed').length, 0)
    } finally { store.close() }
  }
})

test('action listings preserve distinct hook and parameter history rules', () => {
  const store = open()
  try {
    store.ingest('action/review HAS action: `?service => ?service IS reviewed`')
    store.ingest('action/review HAS hook: old-hook\naction/review/service IS param ; old docs', { source: 'agent/one' })
    store.ingest('action/review HAS hook: new-hook\naction/review/service IS param ; new docs', { source: 'agent/two' })
    let listed = listActions(store)[0]!
    assert.equal(listed.hook, 'new-hook')
    assert.equal(listed.params[0]!.doc, 'new docs')
    store.ingest('action/review HAS hook: old-hook @ 0%\naction/review/service IS param @ 0%', { source: 'agent/one' })
    listed = listActions(store)[0]!
    assert.equal(listed.hook, undefined, 'newest hook retraction disables older actor hooks')
    assert.equal(listed.params[0]!.doc, 'new docs', 'another current positive parameter description remains visible')
    store.ingest('action/review/service IS param', { source: 'agent/three' })
    assert.equal(listActions(store)[0]!.params[0]!.doc, undefined, 'a newer positive declaration without a comment wins')
    store.ingest('action/review HAS action: `?service => ?service IS reviewed` @ 0%')
    assert.deepEqual(listActions(store), [])
  } finally { store.close() }
})

test('named declaration lookups retain newest-series retractions and fresh hook changes', () => {
  const store = open()
  try {
    store.ingest('action/handle HAS action: `?x => ?x IS first`\naction/handle HAS hook: first', { source: 'one' })
    store.ingest('action/handle HAS action: `?x => ?x IS second`\naction/handle HAS hook: second', { source: 'two' })
    assert.match(loadAction(store, 'handle')!.loaded!.action.text, /second/)
    assert.equal(currentHook(store, 'action/handle'), 'second')
    store.ingest('action/handle HAS action: `?x => ?x IS first` @ 0%\naction/handle HAS hook: first @ 0%', { source: 'one' })
    assert.equal(loadAction(store, 'handle'), undefined)
    assert.equal(currentHook(store, 'action/handle'), undefined)
    store.ingest('action/handle HAS action: `?x => ?x IS third`\naction/handle HAS hook: third', { source: 'two' })
    assert.match(loadAction(store, 'handle')!.loaded!.action.text, /third/)
    assert.equal(currentHook(store, 'action/handle'), 'third')
  } finally {
    store.close()
  }
})

const claimCount = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

test('an action introducing the first shape still rolls back new violations', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, 'action/add-shape HAS action: `?x => service EXPECTS owner`')
    const before = claimCount(store)
    const report = act(store, 'add-shape', { x: 'api' })
    assert.equal(report.ok, false)
    assert.equal(claimCount(store), before)
    assert.equal(query(store, 'service EXPECTS owner').length, 0)
  } finally { store.close() }
})

const deployAction =
  'action/mark-deployed HAS action: `?service, ?version, ?service IS service => ' +
  '?service HAS deployed-version: ?version` ; record a deployment'

test('execution appends stamped effects with BECAUSE/VIA lineage (spec §25.2)', () => {
  const store = open()
  store.ingest('api-gateway IS service @ 90%')
  const declaration = declareActions(store, deployAction)
  assert.equal(declaration.declared, 1)
  assert.deepEqual(declaration.problems, [])

  const report = act(store, 'mark-deployed', { service: 'api-gateway', version: '1.2.3' })
  assert.equal(report.ok, true)
  assert.ok(report.ok && report.appended === 1)

  const matches = query(store, 'api-gateway HAS deployed-version: ?v @src:action/mark-deployed')
  assert.equal(matches.length, 1)
  assert.equal(matches[0]!.bindings['v'], '1.2.3')
  assert.equal(matches[0]!.row!.conf, 1, 'template confidence, not noisy-AND (spec §25.2)')

  const edges = store.edgesOf(matches[0]!.row!.id)
  const because = edges.filter(edge => edge.role === 'BECAUSE').map(edge => edge.child.raw_line)
  assert.deepEqual(because, ['api-gateway IS service @ 90%'])
  const via = edges.filter(edge => edge.role === 'VIA')
  assert.equal(via.length, 1)
  assert.equal(via[0]!.child.subject, 'action/mark-deployed')
  store.close()
})

test('arguments are validated — unknown and missing parameters fail', () => {
  const store = open()
  store.ingest('api-gateway IS service')
  declareActions(store, deployAction)
  const unknown = act(store, 'mark-deployed', { service: 'api-gateway', version: '1', extra: 'x' })
  assert.equal(unknown.ok, false)
  assert.match((unknown as { error: string }).error, /unknown parameter\(s\) extra/)
  const missing = act(store, 'mark-deployed', { service: 'api-gateway' })
  assert.equal(missing.ok, false)
  assert.match((missing as { error: string }).error, /version requires a value/)
  assert.equal(act(store, 'nope', {}).ok, false)
  store.close()
})

test('a failed precondition appends nothing and names the premise (spec §25.2)', () => {
  const store = open()
  declareActions(store, deployAction)
  const rows = claimCount(store)
  const report = act(store, 'mark-deployed', { service: 'ghost', version: '1' })
  assert.equal(report.ok, false)
  assert.match((report as { error: string }).error, /precondition failed/)
  assert.equal((report as { failedPremise?: string }).failedPremise, '?service IS service')
  assert.equal(claimCount(store), rows, 'nothing appended')
  store.close()
})

test('action gates observe revocations committed before the write reservation', () => {
  for (const revoke of ['premise', 'declaration'] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-act-race-'))
    const path = join(dir, 'knowledge.db')
    const store = open(path)
    const peer = open(path)
    try {
      store.ingest('api-gateway IS service')
      declareActions(store, deployAction)
      let crossed = false
      const intercepted = new Proxy(store, {
        get(target, property, receiver) {
          if (property !== 'transaction') return Reflect.get(target, property, receiver)
          return <T>(body: () => T): T => {
            if (!crossed) {
              crossed = true
              // A second connection wins the lock immediately before this
              // action reserves its write transaction.
              if (revoke === 'premise') peer.ingest('api-gateway IS service @ 0%')
              else retractAction(peer, 'mark-deployed')
            }
            return target.transaction(body)
          }
        },
      })
      const report = act(intercepted, 'mark-deployed', { service: 'api-gateway', version: '1' })
      assert.equal(crossed, true)
      assert.equal(report.ok, false, `the ${revoke} was revoked before the write lock`)
      assert.equal(query(store, 'api-gateway HAS deployed-version: ?v').length, 0)
    } finally {
      peer.close()
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('action retraction selects current series after acquiring its write reservation', () => {
  for (const change of ['new-series', 'already-retracted'] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-act-retract-race-'))
    const path = join(dir, 'knowledge.db')
    const store = open(path)
    const peer = open(path)
    try {
      declareActions(store, deployAction)
      let crossed = false
      let peerHistory = ''
      const intercepted = new Proxy(store, {
        get(target, property, receiver) {
          if (property !== 'transaction') return Reflect.get(target, property, receiver)
          return <T>(body: () => T): T => {
            if (!crossed) {
              crossed = true
              if (change === 'new-series') peer.ingest(`${deployAction} @src:peer`)
              else assert.ok(retractAction(peer, 'mark-deployed').ok)
              peerHistory = peer.exportText({ tx: true, maxSensitivity: 'restricted' })
            }
            return target.transaction(body)
          }
        }
      })
      const result = retractAction(intercepted, 'mark-deployed')
      assert.equal(crossed, true)
      if (change === 'new-series') {
        assert.ok(result.ok)
        assert.equal(result.retracted, 2)
      } else {
        assert.equal(result.ok, false)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), peerHistory)
      }
      assert.equal(store.currentBeliefs().filter(row => row.subject === 'action/mark-deployed' &&
        row.attribute === 'action' && row.negated === 0 && row.conf > 0).length, 0)
      assert.equal(loadAction(store, 'mark-deployed'), undefined)
      assert.equal(declareActions(store, deployAction).declared, 1)
      assert.ok(loadAction(store, 'mark-deployed')?.loaded)
    } finally {
      peer.close()
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('failed multi-series action retraction rolls back and retains past effects on retry', t => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, deployAction)
    store.ingest(`${deployAction} @src:peer`)
    assert.ok(act(store, 'mark-deployed', { service: 'api', version: '1' }).ok)
    const effect = query(store, 'api HAS deployed-version: ?v')[0]!.row!
    const lineage = store.edgesOf(effect.id)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const failure = new Error('second declaration write failed')
    const insert = store.insertResult.bind(store)
    let writes = 0
    const mocked = t.mock.method(store, 'insertResult', (...args: Parameters<typeof store.insertResult>) => {
      const result = insert(...args)
      if (++writes === 2) throw failure
      return result
    })
    assert.throws(() => retractAction(store, 'mark-deployed'), error => error === failure)
    assert.equal(writes, 2)
    mocked.mock.restore()
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.deepEqual(store.edgesOf(effect.id), lineage)
    assert.ok(loadAction(store, 'mark-deployed')?.loaded)

    const retried = retractAction(store, 'mark-deployed')
    assert.ok(retried.ok)
    assert.equal(retried.retracted, 2)
    assert.equal(loadAction(store, 'mark-deployed'), undefined)
    assert.deepEqual(query(store, 'api HAS deployed-version: ?v')[0]!.row, effect)
    assert.deepEqual(store.edgesOf(effect.id), lineage)
    const retractedHistory = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(retractAction(store, 'mark-deployed').ok, false)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), retractedHistory)
  } finally { store.close() }
})

test('an already-open action store uses vocabulary committed by another writer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-act-vocabulary-'))
  const path = join(dir, 'knowledge.db')
  const store = open(path)
  const peer = open(path)
  try {
    peer.ingest('MANAGES IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES api')
    declareActions(peer, 'action/mark-managed HAS action: `?service, ?service MANAGED-BY alice => ?service IS managed`')
    const report = act(store, 'mark-managed', { service: 'api' })
    assert.equal(report.ok, true, JSON.stringify(report))
    assert.equal(query(store, 'api IS managed').length, 1)
    peer.ingest('MANAGES RENAMED-TO SUPERVISES')
    declareActions(peer, 'action/mark-managed HAS action: `?service, alice SUPERVISES ?service => ?service IS supervised`')
    const renamed = act(store, 'mark-managed', { service: 'api' })
    assert.equal(renamed.ok, true, JSON.stringify(renamed))
    assert.equal(query(store, 'api IS supervised').length, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const repeated = act(store, 'mark-managed', { service: 'api' })
    assert.ok(repeated.ok && repeated.unchanged === 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally {
    peer.close()
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('solver proposals receive no authority and recheck current action preconditions', () => {
  const store = open()
  declareActions(store, deployAction)
  const proposal = {
    action: 'mark-deployed',
    parameters: { service: 'api', version: '2.0' }
  }
  const stale = actProposal(store, proposal)
  assert.equal(stale.ok, false)
  assert.match((stale as { error: string }).error, /precondition failed/)
  assert.equal(query(store, 'api HAS deployed-version: ?v').length, 0)

  store.ingest('api IS service')
  const current = actProposal(store, proposal)
  assert.ok(current.ok && current.appended === 1)
  store.close()
})

test('premise-bound variables flow into effects; ambiguity fails the action', () => {
  const store = open()
  store.ingest('api IS service\napi HAS owner: team-a\napi USES postgres\napi USES redis')
  declareActions(store,
    'action/ack HAS action: `?service, ?service HAS owner: ?owner => ?owner YIELDS ack`\n' +
    'action/tag-dep HAS action: `?service, ?service USES ?dep => ?service LIKE ?dep`')

  const ok = act(store, 'ack', { service: 'api' })
  assert.equal(ok.ok, true)
  assert.equal(query(store, 'team-a YIELDS ack').length, 1)

  const ambiguous = act(store, 'tag-dep', { service: 'api' })
  assert.equal(ambiguous.ok, false)
  assert.match((ambiguous as { error: string }).error, /ambiguous binding for \?dep/)
  store.close()
})

test('ordered action effects apply RENAMED-TO before later writes (spec §5.8, §25.2)', () => {
  const store = open()
  declareActions(store,
    'action/adopt-verb HAS action: `=> WORKS-AT RENAMED-TO EMPLOYED-BY, alice EMPLOYED-BY acme`')
  const report = act(store, 'adopt-verb', {})
  assert.ok(report.ok)
  assert.equal(Registry.preferredOf(store.registry(), 'WORKS-AT'), 'EMPLOYED-BY')
  assert.equal(query(store, 'alice WORKS-AT acme').length, 1)
  assert.equal(query(store, 'alice EMPLOYED-BY acme').length, 1)
  store.close()
})

test('re-runs are idempotent; changed values update the same belief series', () => {
  const store = open()
  store.ingest('api IS service')
  declareActions(store, deployAction)
  act(store, 'mark-deployed', { service: 'api', version: '1.0' })
  const rows = claimCount(store)

  const again = act(store, 'mark-deployed', { service: 'api', version: '1.0' })
  assert.ok(again.ok && again.unchanged === 1 && again.appended === 0)
  assert.equal(claimCount(store), rows, 'idempotent re-run appends nothing')

  const bumped = act(store, 'mark-deployed', { service: 'api', version: '2.0' })
  assert.ok(bumped.ok && bumped.updated === 1)
  const current = query(store, 'api HAS deployed-version: ?v')
  assert.equal(current.length, 1)
  assert.equal(current[0]!.bindings['v'], '2.0')
  assert.equal(store.history(current[0]!.row!.claim_key).length, 2, 'append-only series')
  store.close()
})

test('the action gate distinguishes violation names containing separators', () => {
  const store = open()
  try {
    store.ingest('worker EXPECTS owner\nservice\0worker EXPECTS owner\napi\0service IS worker', { strict: true })
    declareActions(store, 'action/enroll HAS action: `?name => ?name IS service\0worker`')
    const before = claimCount(store)
    const report = act(store, 'enroll', { name: 'api' })
    assert.equal(report.ok, false)
    assert.match((report as { error: string }).error, /shape gate/)
    assert.equal(claimCount(store), before, 'effects and lineage roll back together')
    assert.equal(query(store, 'api IS service\0worker').length, 0)
  } finally { store.close() }
})

test('the shape gate rejects executions that introduce violations (spec §25.3)', () => {
  const store = open()
  declareActions(store,
    'service EXPECTS owner\n' +
    'action/enroll HAS action: `?name => ?name IS service`')
  const rejectedReport = act(store, 'enroll', { name: 'cache' })
  assert.equal(rejectedReport.ok, false)
  assert.match((rejectedReport as { error: string }).error, /shape gate/)
  assert.equal(query(store, 'cache IS service').length, 0, 'rolled back')

  const unchecked = act(store, 'enroll', { name: 'cache' }, { check: false })
  assert.equal(unchecked.ok, true)
  assert.equal(query(store, 'cache IS service').length, 1)
  store.close()
})

test('dry runs report without persisting and never fire hooks', () => {
  const store = open()
  store.ingest('api IS service')
  declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
  const rows = claimCount(store)
  const report = act(store, 'mark-deployed', { service: 'api', version: '1' },
    { dryRun: true, hooks: { notify: 'false' } })
  assert.ok(report.ok && report.dryRun)
  assert.equal(report.ok && report.appended, 1)
  assert.equal(claimCount(store), rows)
  assert.equal(report.ok ? report.hook?.fired : undefined, false)
  assert.equal(report.ok ? report.hook?.note : undefined, 'dry run')
  store.close()
})

test('changing dry-run options cannot report a commit or evaluate a hook', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    let reads = 0
    let hookReads = 0
    const result = act(store, 'mark-deployed', { service: 'api', version: '1' }, {
      get dryRun() { return ++reads === 1 },
      hooks: { get notify(): string { hookReads++; throw new Error('must not resolve a dry-run hook') } }
    })
    assert.ok(result.ok && result.dryRun)
    assert.equal(result.hook?.note, 'dry run')
    assert.equal(hookReads, 0)
    assert.equal(reads, 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})

test('hooks fire after commit with quoted placeholders and claims on stdin (spec §25.4)', () => {
  const store = open()
  const out = join(mkdtempSync(join(tmpdir(), 'cave-act-')), 'hook.json')
  store.ingest('api IS service')
  declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
  const script = 'const fs=require(\'fs\');' +
    'fs.writeFileSync(process.argv[1],JSON.stringify({args:process.argv.slice(2),stdin:fs.readFileSync(0,\'utf8\')}))'
  const report = act(store, 'mark-deployed', { service: 'api', version: 'it\'s "1.0"' }, {
    hooks: { notify: `node -e "${script}" ${out} {action} {version} {nope}` }
  })
  assert.ok(report.ok)
  assert.equal(report.ok ? report.hook?.fired : undefined, true)
  assert.equal(report.ok ? report.hook?.code : undefined, 0)
  const recorded = JSON.parse(readFileSync(out, 'utf8')) as { args: string[], stdin: string }
  assert.deepEqual(recorded.args, ['mark-deployed', 'it\'s "1.0"', '{nope}'],
    'values shell-quoted verbatim; unknown placeholders left intact')
  assert.match(recorded.stdin, /api HAS deployed-version:/)
  store.close()
})

test('hooks run after the governed transaction commits and a peer can read its effects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-act-commit-'))
  const path = join(dir, 'knowledge.db')
  const store = open(path)
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    let observed = false
    const report = act(store, 'mark-deployed', { service: 'api', version: '1' }, {
      hooks: {
        get notify() {
          assert.equal(store.adapter.capabilities.backup!.inTransaction(store.db), false)
          const peer = open(path)
          try { assert.equal(query(peer, 'api HAS deployed-version: ?v')[0]?.bindings['v'], '1') }
          finally { peer.close() }
          observed = true
          return 'node -e "process.exit(0)"'
        },
      },
    })
    assert.ok(report.ok)
    assert.equal(observed, true)
    assert.equal(report.hook?.code, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configured hooks cannot escape a caller-owned transaction on commit or rollback', () => {
  for (const rollbackOuter of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-act-nested-'))
    const marker = join(dir, 'hook.txt')
    const store = open()
    const rollback = Symbol('outer rollback')
    try {
      store.ingest('api IS service')
      declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
      try {
        store.transaction(() => {
          store.ingest('caller IS active')
          const report = act(store, 'mark-deployed', { service: 'api', version: '1' }, {
            hooks: { notify: `node -e ${shellQuote('require("node:fs").writeFileSync(process.argv[1], "fired")')} ${shellQuote(marker)}` },
          })
          assert.equal(report.ok, false)
          assert.match(report.ok ? '' : report.error, /caller-owned transaction/)
          assert.equal(query(store, 'api HAS deployed-version: ?v').length, 0)
          assert.equal(query(store, 'caller IS active').length, 1, 'only the action savepoint rolls back')
          if (rollbackOuter) throw rollback
        })
      } catch (error) { if (error !== rollback) throw error }
      assert.equal(existsSync(marker), false)
      assert.equal(query(store, 'caller IS active').length, rollbackOuter ? 0 : 1)
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('nested actions without external effects retain commit, rollback, dry-run, and no-op behavior', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    const args = { service: 'api', version: '1' }
    const hooks = { notify: 'node -e "process.exit(99)"' }
    const dry = store.transaction(() => act(store, 'mark-deployed', args, { hooks, dryRun: true }))
    assert.ok(dry.ok)
    assert.equal(dry.hook?.note, 'dry run')
    assert.equal(query(store, 'api HAS deployed-version: ?v').length, 0)
    const committed = store.transaction(() => act(store, 'mark-deployed', args))
    assert.ok(committed.ok)
    assert.equal(committed.hook?.note, 'not configured')
    const noop = store.transaction(() => act(store, 'mark-deployed', args, { hooks }))
    assert.ok(noop.ok)
    assert.equal(noop.hook?.note, 'nothing changed')
    assert.throws(() => store.transaction(() => {
      assert.ok(act(store, 'mark-deployed', { ...args, version: '2' }).ok)
      throw new Error('caller cancelled')
    }), /caller cancelled/)
    assert.equal(query(store, 'api HAS deployed-version: ?v')[0]?.bindings['v'], '1')
  } finally { store.close() }
})

test('hook failures are reported; committed claims stay (spec §25.4)', () => {
  const store = open()
  store.ingest('api IS service')
  declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)

  const unconfigured = act(store, 'mark-deployed', { service: 'api', version: '1' })
  assert.ok(unconfigured.ok)
  assert.equal(unconfigured.ok ? unconfigured.hook?.note : undefined, 'not configured')

  const failing = act(store, 'mark-deployed', { service: 'api', version: '2' },
    { hooks: { notify: 'node -e "process.exit(3)"' } })
  assert.ok(failing.ok, 'the execution itself succeeds')
  assert.match(failing.ok && failing.hook?.error || '', /exited with 3/)
  assert.equal(query(store, 'api HAS deployed-version: ?v')[0]!.bindings['v'], '2')

  const noop = act(store, 'mark-deployed', { service: 'api', version: '2' },
    { hooks: { notify: 'node -e "process.exit(3)"' } })
  assert.ok(noop.ok)
  assert.equal(noop.ok ? noop.hook?.note : undefined, 'nothing changed',
    'no-op executions never fire hooks')
  store.close()
})

test('a timed-out hook retains committed history and is not retried by a no-op action', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    const args = { service: 'api', version: 'timeout' }
    const report = act(store, 'mark-deployed', args, {
      hooks: { notify: `node -e ${shellQuote('setTimeout(() => {}, 10000)')}` },
      hookTimeoutSeconds: 0.2
    })
    assert.ok(report.ok)
    assert.equal(report.hook?.fired, true)
    assert.match(report.hook?.error ?? '', /timed out after 200ms/)
    const effect = query(store, 'api HAS deployed-version: ?v')[0]!.row!
    assert.equal(query(store, 'api HAS deployed-version: ?v')[0]!.bindings['v'], 'timeout')
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const lineage = store.edgesOf(effect.id)
    assert.ok(lineage.some(edge => edge.role === 'BECAUSE'))
    assert.ok(lineage.some(edge => edge.role === 'VIA'))
    let lookups = 0
    const hooks = { get notify() { lookups++; return 'echo recovered' } }
    const repeated = act(store, 'mark-deployed', args, { hooks })
    assert.ok(repeated.ok)
    assert.equal(repeated.hook?.fired, false)
    assert.equal(repeated.hook?.note, 'nothing changed')
    assert.equal(lookups, 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    assert.deepEqual(store.edgesOf(effect.id), lineage)

    const changed = act(store, 'mark-deployed', { ...args, version: 'later' }, { hooks })
    assert.ok(changed.ok)
    assert.equal(changed.hook?.output, 'recovered')
    assert.equal(lookups, 1)
    assert.deepEqual(store.edgesOf(effect.id), lineage, 'later updates retain historical lineage')
  } finally { store.close() }
})

test('hook output limits fail safely after the governed write commits', () => {
  const store = open()
  store.ingest('api IS service')
  declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
  const report = act(store, 'mark-deployed', { service: 'api', version: '3' }, {
    hooks: { notify: 'node -e "process.stdout.write(\'begin-\' + \'x\'.repeat(4096) + \'-end\')"' },
    hookMaxStdoutBytes: 64
  })
  assert.ok(report.ok)
  assert.match(report.ok && report.hook?.error || '', /stdout exceeded 64 bytes/)
  assert.equal(report.ok && report.hook?.output, 'begin-' + 'x'.repeat(58))
  assert.equal(query(store, 'api HAS deployed-version: ?v')[0]!.bindings['v'], '3')
  store.close()
})

test('declaration lifecycle — idempotent declare, list with docs, retract disables', () => {
  const store = open()
  const file = [
    '; deploy vocabulary',
    '',
    deployAction,
    'action/mark-deployed/service IS param ; the service that was deployed',
    'action/mark-deployed/version IS param ; the version now running',
    'action/mark-deployed HAS hook: deploy-notify'
  ].join('\n')
  const first = declareActions(store, file)
  assert.equal(first.declared, 1)
  assert.ok(first.prelude >= 3)

  const again = declareActions(store, file)
  assert.equal(again.declared, 0)
  assert.equal(again.unchanged, 1)
  assert.equal(again.prelude, 0, 'prelude digest guard skips re-appending')

  const listed = listActions(store)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.name, 'mark-deployed')
  assert.equal(listed[0]!.description, 'record a deployment')
  assert.equal(listed[0]!.hook, 'deploy-notify')
  assert.deepEqual(listed[0]!.params, [
    { name: 'service', doc: 'the service that was deployed' },
    { name: 'version', doc: 'the version now running' }
  ])

  const changed = declareActions(store,
    'action/mark-deployed HAS action: `?service, ?version => ?service HAS deployed-version: ?version` ; looser')
  assert.equal(changed.declared, 1, 'a changed body redeclares')

  const retraction = retractAction(store, 'mark-deployed')
  assert.ok(retraction.ok)
  assert.equal(listActions(store).length, 0)
  const gone = act(store, 'mark-deployed', { service: 'api', version: '1' })
  assert.equal(gone.ok, false)
  assert.match((gone as { error: string }).error, /no current action/)
  store.close()
})

test('declaration problems are reported with line numbers, never thrown', () => {
  const store = open()
  const declaration = declareActions(store, [
    'action/broken HAS action: `?x IS y`',
    'action/unbound HAS action: `=> ?ghost EXISTS`'
  ].join('\n'))
  assert.equal(declaration.declared, 0)
  assert.equal(declaration.problems.length, 2)
  assert.equal(declaration.problems[0]!.line, 1)
  assert.match(declaration.problems[0]!.message, /no top-level "=>"/)
  assert.equal(declaration.problems[1]!.line, 2)
  assert.match(declaration.problems[1]!.message, /neither a parameter nor bound/)
  store.close()
})

test('mixed declaration imports retain invalid replacements while applying valid metadata and actions', () => {
  const store = open()
  try {
    declareActions(store, 'action/mark HAS action: `=> api IS old`\naction/mark HAS hook: old-hook')
    const original = loadAction(store, 'mark')!.loaded!.row
    const lines = [
      '; replacement import',
      'action/mark HAS action: `missing arrow`',
      'action/mark HAS hook: new-hook',
      'action/other HAS action: `=> other IS ready`'
    ]
    const partial = declareActions(store, lines.join('\r\n'))
    assert.equal(partial.declared, 1)
    assert.equal(partial.unchanged, 0)
    assert.equal(partial.prelude, 1)
    assert.deepEqual(partial.problems.map(problem => problem.line), [2])
    assert.deepEqual(partial.actions.map(action => action.name), ['other'])
    assert.deepEqual(loadAction(store, 'mark')!.loaded!.row, original)
    assert.equal(currentHook(store, 'action/mark'), 'new-hook')
    assert.ok(loadAction(store, 'other')?.loaded)
    const partialHistory = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const repeated = declareActions(store, lines.join('\r\n'))
    assert.equal(repeated.declared, 0)
    assert.equal(repeated.unchanged, 1)
    assert.equal(repeated.prelude, 0)
    assert.deepEqual(repeated.problems, partial.problems)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), partialHistory)
    const executed = act(store, 'mark', {}, { hooks: { 'new-hook': 'echo new-metadata' } })
    assert.ok(executed.ok)
    assert.equal(executed.hook?.output, 'new-metadata')
    assert.equal(query(store, 'api IS old').length, 1)

    lines[1] = 'action/mark HAS action: `=> api IS new`'
    const corrected = declareActions(store, lines.join('\r\n'))
    assert.equal(corrected.declared, 1)
    assert.equal(corrected.unchanged, 1)
    assert.equal(corrected.prelude, 0)
    assert.deepEqual(corrected.problems, [])
    assert.equal(loadAction(store, 'mark')!.loaded!.action.text, '=> api IS new')
    const correctedHistory = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(declareActions(store, lines.join('\r\n')).unchanged, 2)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), correctedHistory)
  } finally { store.close() }
})

test('unconditional and parameterless actions execute', () => {
  const store = open()
  declareActions(store, 'action/open-window HAS action: `=> maintenance-window EXISTS @ 90%`')
  const report = act(store, 'open-window')
  assert.ok(report.ok && report.appended === 1 && report.solutions === 1)
  assert.equal(query(store, 'maintenance-window EXISTS').length, 1)
  store.close()
})

test('an effect naming its own @src: still carries execution attribution (BUGS.md src-stamp-bypass, spec §25.2)', () => {
  const store = open()
  store.ingest('api-gateway IS service')
  declareActions(store,
    'action/mark-deployed HAS action: `?service, ?version, ?service IS service => ' +
    '?service HAS deployed-version: ?version @src:release-bot`')
  const report = act(store, 'mark-deployed', { service: 'api-gateway', version: '1.2.3' })
  assert.ok(report.ok && report.appended === 1)
  const matches = query(store, 'api-gateway HAS deployed-version: ?v @src:action/mark-deployed')
  assert.equal(matches.length, 1, 'the execution stamp is mandatory')
  assert.ok(store.toClaim(matches[0]!.row!).contexts.includes('src:release-bot'), 'the authored source is kept')
  assert.equal(store.byProvenance('run', 'action/mark-deployed').some(row => row.id === matches[0]!.row!.id), true)
  store.close()
})

test('constraints gate on parameter values', () => {
  const store = open()
  declareActions(store, 'action/scale HAS action: `?replicas, ?replicas <= 10 => cluster HAS replicas: ?replicas`')
  const over = act(store, 'scale', { replicas: 12 })
  assert.equal(over.ok, false)
  assert.match((over as { error: string }).error, /precondition failed.*replicas <= 10/)
  const ok = act(store, 'scale', { replicas: 4 })
  assert.ok(ok.ok && ok.appended === 1)
  store.close()
})

test('action history retains per-execution lineage across no-op, dry-run, and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-act-lineage-'))
  const path = join(dir, 'knowledge.db')
  let store = open(path)
  try {
    store.ingest('api IS service @ 90%')
    declareActions(store, deployAction)
    const declaration = loadAction(store, 'mark-deployed')!.loaded!.row.id
    const firstPremise = query(store, 'api IS service')[0]!.row!.id
    assert.ok(act(store, 'mark-deployed', { service: 'api', version: '1' }).ok)
    const first = query(store, 'api HAS deployed-version: ?v')[0]!.row!
    const edges = (id: string) => store.edgesOf(id).map(edge => [edge.role, edge.child.id]).sort()
    const firstEdges = [['BECAUSE', firstPremise], ['VIA', declaration]].sort()
    assert.deepEqual(edges(first.id), firstEdges)

    store.ingest('api IS service @ 95%')
    const secondPremise = query(store, 'api IS service')[0]!.row!.id
    assert.notEqual(secondPremise, firstPremise)
    const noop = act(store, 'mark-deployed', { service: 'api', version: '1' })
    assert.ok(noop.ok && noop.unchanged === 1)
    assert.equal(query(store, 'api HAS deployed-version: ?v')[0]!.row!.id, first.id)
    assert.deepEqual(edges(first.id), firstEdges)

    const beforeClaims = claimCount(store)
    const beforeEdges = store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all()
    const dry = act(store, 'mark-deployed', { service: 'api', version: '2' }, { dryRun: true })
    assert.ok(dry.ok && dry.updated === 1)
    assert.equal(claimCount(store), beforeClaims)
    assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all(), beforeEdges)

    const update = act(store, 'mark-deployed', { service: 'api', version: '2' })
    assert.ok(update.ok && update.updated === 1)
    const second = query(store, 'api HAS deployed-version: ?v')[0]!.row!
    assert.notEqual(second.id, first.id)
    store.close()
    store = open(path)
    assert.deepEqual(new Set(store.history(first.claim_key).map(row => row.id)), new Set([first.id, second.id]))
    assert.deepEqual(edges(first.id), firstEdges)
    assert.deepEqual(edges(second.id), [['BECAUSE', secondPremise], ['VIA', declaration]].sort())
    assert.deepEqual(store.provenanceOf(first.id).runs, ['action/mark-deployed'])
    assert.deepEqual(store.provenanceOf(second.id).runs, ['action/mark-deployed'])
    assert.equal(query(store, 'api HAS deployed-version: ?v')[0]!.bindings['v'], '2')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


test('unchanged actions skip shape snapshots while changed effects retain the full gate', t => {
  const store = open()
  try {
    store.ingest('service EXPECTS owner')
    declareActions(store, 'action/classify HAS action: `?name, ?kind => ?name IS tracked, ?name IS ?kind`')
    let snapshots = 0
    const exec = store.db.exec.bind(store.db)
    t.mock.method(store.db, 'exec', (sql: string) => {
      if (sql === 'SAVEPOINT cave_shape_evaluation') snapshots++
      return exec(sql)
    })
    const first = act(store, 'classify', { name: 'api', kind: 'plain' })
    assert.ok(first.ok && first.appended === 2)
    assert.equal(snapshots, 2)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const dryRun of [false, true]) {
      snapshots = 0
      const again = act(store, 'classify', { name: 'api', kind: 'plain' }, { dryRun })
      assert.ok(again.ok && again.unchanged === 2)
      assert.equal(snapshots, 0, 'no changed effects require no shape snapshots')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    snapshots = 0
    const rejected = act(store, 'classify', { name: 'api', kind: 'service' })
    assert.equal(rejected.ok, false)
    assert.equal(snapshots, 2, 'an unchanged prefix must not bypass the gate on a later changed effect')
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(query(store, 'api IS service').length, 0)
  } finally { store.close() }
})


test('existing action effects do not bypass premises invalidated by qualifier edges', () => {
  for (const writer of ['same', 'peer']) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-act-qualifier-'))
    const path = join(dir, 'knowledge.db')
    const store = open(path)
    const peer = open(path)
    try {
      const { ids } = store.ingest('MANAGES IS verb\nMANAGED-BY IS verb\nMANAGES REVERSE MANAGED-BY\nalice MANAGES api\nreview IS complete')
      declareActions(store, 'action/mark HAS action: `?service, ?service MANAGED-BY alice => ?service IS managed`')
      assert.equal(act(store, 'mark', { service: 'api' }).ok, true)
      const effect = query(store, 'api IS managed')[0]!.row!
      const lineage = store.edgesOf(effect.id)
      const connection = writer === 'same' ? store : peer
      connection.appendEdges([{ parentId: ids[4]!, role: 'WHEN', childId: ids[2]! }])
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const dryRun of [false, true]) {
        const report = act(store, 'mark', { service: 'api' }, { dryRun })
        assert.equal(report.ok, false, writer)
        assert.match(report.ok ? '' : report.error, /precondition failed/)
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      assert.equal(query(store, 'api MANAGED-BY alice').length, 0)
      assert.equal(query(store, 'api IS managed')[0]!.row!.id, effect.id,
        'past action effects remain historical assertions')
      assert.deepEqual(store.edgesOf(effect.id), lineage)
    } finally { peer.close(); store.close(); rmSync(dir, { recursive: true, force: true }) }
  }
})


test('malformed shapes block changed effects while unchanged actions remain read-only', () => {
  const store = open()
  try {
    declareActions(store, 'action/mark HAS action: `?name => ?name IS marked`')
    assert.equal(act(store, 'mark', { name: 'first' }).ok, true)
    store.ingest('service EXPECTS owner #cardinality:many')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const unchanged = act(store, 'mark', { name: 'first' })
    assert.ok(unchanged.ok && unchanged.unchanged === 1)
    assert.throws(() => act(store, 'mark', { name: 'second' }), /cardinality/)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(query(store, 'second IS marked').length, 0)
  } finally { store.close() }
})


test('metadata-only action edits preserve existing effects until their value changes', () => {
  const store = open()
  try {
    declareActions(store, 'action/stage HAS action: `?value => api HAS stage: ?value #status:old`')
    assert.equal(act(store, 'stage', { value: 'alpha' }).ok, true)
    const first = query(store, 'api HAS stage: ?value')[0]!.row!
    const lineage = store.edgesOf(first.id)
    assert.match(first.raw_line, /#status:old/)
    declareActions(store, 'action/stage HAS action: `?value => api HAS stage: ?value #status:new`')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const same = act(store, 'stage', { value: 'alpha' })
    assert.ok(same.ok && same.unchanged === 1)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    assert.equal(query(store, 'api HAS stage: ?value')[0]!.row!.id, first.id)
    assert.deepEqual(store.edgesOf(first.id), lineage)
    const changed = act(store, 'stage', { value: 'beta' })
    assert.ok(changed.ok && changed.updated === 1)
    const latest = query(store, 'api HAS stage: ?value')[0]!.row!
    assert.notEqual(latest.id, first.id)
    assert.match(latest.raw_line, /#status:new/)
    assert.deepEqual(store.edgesOf(first.id), lineage, 'old lineage remains historical')
  } finally { store.close() }
})

test('hook budget validation precedes action writes and accepts whole-millisecond decimal seconds', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const hooks = { notify: 'echo completed' }
    for (const limits of [
      ...[-1, NaN, Infinity, 0.0001, 2147483.648].map(hookTimeoutSeconds => ({ hookTimeoutSeconds })),
      ...[-1, 0.5, Infinity].flatMap(value => [{ hookMaxStdoutBytes: value }, { hookMaxStderrBytes: value }])
    ]) {
      const rejected = act(store, 'mark-deployed', { service: 'api', version: 'new' }, { hooks, ...limits })
      assert.equal(rejected.ok, false, JSON.stringify(limits))
      if (!rejected.ok) assert.match(rejected.error, /hook.*nothing appended/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const result = act(store, 'mark-deployed', { service: 'api', version: 'new' }, { hooks, hookTimeoutSeconds: 1.001 })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.hook?.error, undefined)
      assert.equal(result.hook?.code, 0)
      assert.equal(result.hook?.output, 'completed')
    }
    const unlimited = act(store, 'mark-deployed', { service: 'api', version: 'unlimited' }, { hooks, hookTimeoutSeconds: 0 })
    assert.equal(unlimited.ok, true)
    if (unlimited.ok) assert.equal(unlimited.hook?.code, 0, 'zero retains the explicit no-timeout behavior')
  } finally { store.close() }
})

test('nonnumeric hook timeouts return validation failures without coercion, writes or hook lookup', () => {
  const store = open()
  let coercions = 0, lookups = 0
  const hooks = { get notify() { lookups++; return 'echo completed' } }
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const value of [null, 1n, Symbol('timeout'), '1', true, new Number(1), [1],
      { [Symbol.toPrimitive]() { coercions++; return 1 } },
      { [Symbol.toPrimitive]() { coercions++; throw new Error('unexpected coercion') } }
    ]) {
      const result = act(store, 'mark-deployed', { service: 'api', version: 'new' }, {
        hooks, hookTimeoutSeconds: value as unknown as number
      })
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, /hookTimeoutSeconds.*whole milliseconds.*nothing appended/)
      assert.equal(coercions, 0)
      assert.equal(lookups, 0)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    const recovered = act(store, 'mark-deployed', { service: 'api', version: 'new' }, { hooks, hookTimeoutSeconds: 1.001 })
    assert.equal(recovered.ok, true)
    if (recovered.ok) assert.equal(recovered.hook?.output, 'completed')
    assert.equal(lookups, 1)
    assert.equal(coercions, 0)
  } finally { store.close() }
})

test('action hooks require own configuration entries, including prototype-named hooks', () => {
  for (const name of ['constructor', 'toString', 'inherited']) {
    const store = open()
    try {
      store.ingest('api IS service')
      declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: ${name}`)
      const hooks = name === 'inherited' ? Object.create({ inherited: 'echo inherited' }) : {}
      const result = act(store, 'mark-deployed', { service: 'api', version: '1' }, { hooks })
      assert.equal(result.ok, true)
      if (result.ok) {
        assert.equal(result.hook?.fired, false)
        assert.equal(result.hook?.note, 'not configured')
      }
      const nested = store.transaction(() => act(store, 'mark-deployed', { service: 'api', version: '2' }, { hooks }))
      assert.equal(nested.ok, true, 'an inherited property does not trigger the nested-hook restriction')
      const configured = act(store, 'mark-deployed', { service: 'api', version: '3' }, {
        hooks: { [name]: 'echo configured' }
      })
      assert.equal(configured.ok, true)
      if (configured.ok) {
        assert.equal(configured.hook?.code, 0)
        assert.equal(configured.hook?.output, 'configured')
      }
    } finally { store.close() }
  }
})

for (const flag of ['dryRun', 'check', 'aliases'] as const) {
  test(`action ${flag} rejects malformed modes before effects commit`, () => {
    const store = open()
    try {
      store.ingest('api IS service')
      declareActions(store, deployAction)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        const result = act(store, 'mark-deployed', { service: 'api', version: 'new' }, { [flag]: value as never })
        assert.equal(result.ok, false, JSON.stringify(value))
        if (!result.ok) assert.match(result.error, new RegExp(`${flag} must be a boolean`))
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      }
      const preview = act(store, 'mark-deployed', { service: 'api', version: 'new' }, { dryRun: true })
      assert.equal(preview.ok, true)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      const committed = act(store, 'mark-deployed', { service: 'api', version: 'new' }, { [flag]: false })
      assert.equal(committed.ok, true)
      assert.notEqual(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  })
}

test('malformed hook mappings reject actions before effects commit', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    for (const hooks of [null, [], 'echo bad', { notify: 42 }, { unused: false },
      Object.defineProperty({}, 'notify', { value: 42 })]) {
      const result = act(store, 'mark-deployed', { service: 'api', version: 'new' }, { hooks: hooks as never })
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, /hooks/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
  } finally { store.close() }
})

test('lazy hook lookup failures retain committed reports and skipped hooks never invoke getters', () => {
  const store = open()
  try {
    store.ingest('api IS service')
    declareActions(store, `${deployAction}\naction/mark-deployed HAS hook: notify`)
    let reads = 0
    const hooks = { get notify(): string { reads++; throw new Error('private configuration detail') } }
    const dry = act(store, 'mark-deployed', { service: 'api', version: '1' }, { hooks, dryRun: true })
    assert.equal(dry.ok, true)
    assert.equal(reads, 0)
    const report = act(store, 'mark-deployed', { service: 'api', version: '1' }, { hooks })
    assert.equal(report.ok, true)
    if (report.ok) {
      assert.equal(report.hook?.fired, false)
      assert.equal(report.hook?.error, 'hook configuration lookup failed')
    }
    assert.equal(query(store, 'api HAS deployed-version: ?v')[0]!.bindings.v, '1')
    assert.equal(reads, 1)
    const noop = act(store, 'mark-deployed', { service: 'api', version: '1' }, { hooks })
    assert.equal(noop.ok, true)
    assert.equal(reads, 1)
    const nested = store.transaction(() => act(store, 'mark-deployed', { service: 'api', version: '2' }, { hooks }))
    assert.equal(nested.ok, false)
    assert.equal(reads, 1, 'nested-hook rejection does not evaluate an external getter')
    assert.equal(query(store, 'api HAS deployed-version: ?v')[0]!.bindings.v, '1')
    const invalid = act(store, 'mark-deployed', { service: 'api', version: '3' }, {
      hooks: { get notify() { return 42 as never } }
    })
    assert.equal(invalid.ok, true)
    if (invalid.ok) {
      assert.equal(invalid.hook?.fired, false)
      assert.equal(invalid.hook?.error, 'hook command must be a string')
    }
  } finally { store.close() }
})


test('action parameters use subject formatting for entity premises and value formatting for numeric premises', () => {
  const store = open()
  try {
    store.ingest('"20 kg" IS record\nsensor HAS weight: 20 kg')
    const declared = declareActions(store,
      'action/mark HAS action: `?id, ?id IS record, sensor HAS weight: ?id => ?id IS marked, result HAS amount: ?id`')
    assert.equal(declared.declared, 1)
    let reads = 0
    const result = act(store, 'mark', { get id() { reads += 1; return reads === 1 ? '20 kg' : 'wrong' } })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(reads, 1)
    assert.equal(query(store, '"20 kg" IS marked').length, 1)
    assert.equal(query(store, 'result HAS amount: 20 kg').length, 1)
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const repeated = act(store, 'mark', { id: '20 kg' })
    assert.ok(repeated.ok && repeated.appended === 0)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
  } finally { store.close() }
})


test('action confidence revisions preserve retraction, tiny changes and reactivation', () => {
  const store = open()
  try {
    let previousId: string | undefined
    for (const [percentage, confidence] of [
      ['0%', 0], ['0.00000001%', 1e-10], ['0.0000000101%', 1.01e-10],
      ['0%', 0], ['0.00000001%', 1e-10],
    ] as const) {
      assert.equal(declareActions(store, `action/confidence HAS action: \`=> sensor IS active @ ${percentage}\``).declared, 1)
      const executed = act(store, 'confidence')
      assert.ok(executed.ok, JSON.stringify(executed))
      assert.equal(executed.appended + executed.updated, 1, percentage)
      const row = store.currentBeliefs().find(row => row.subject === 'sensor')!
      assert.equal(row.conf, confidence, percentage)
      assert.notEqual(row.id, previousId)
      previousId = row.id
      assert.equal(store.edgesOf(row.id).filter(edge => edge.role === 'VIA').length, 1)
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const repeated = act(store, 'confidence')
      assert.ok(repeated.ok && repeated.unchanged === 1)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
  } finally { store.close() }
})


test('premise-bound prototype names resolve uniquely into action effects', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    const store = open()
    try {
      const declaration = declareActions(store, `action/review HAS action: \`?${name} IS service => ?${name} IS reviewed\``)
      assert.equal(declaration.declared, 1, JSON.stringify(declaration))
      store.ingest('api IS service')
      const result = act(store, 'review', {})
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(query(store, 'api IS reviewed').length, 1)
      store.ingest('worker IS service')
      const ambiguous = act(store, 'review', {})
      assert.equal(ambiguous.ok, false)
      if (!ambiguous.ok) assert.match(ambiguous.error, /ambiguous binding/)
      assert.equal(query(store, 'worker IS reviewed').length, 0)
    } finally { store.close() }
  }
})


test('constraints select prototype-named premise bindings before action effect uniqueness', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    const store = open()
    try {
      const declared = declareActions(store, `action/select HAS action: \`?svc HAS score: ?${name}, ?${name} >= 5 => ?svc HAS selected-score: ?${name}\``)
      assert.equal(declared.declared, 1, JSON.stringify(declared))
      store.ingest('low HAS score: 2')
      assert.equal(act(store, 'select', {}).ok, false)
      assert.equal(query(store, '?svc HAS selected-score: ?n').length, 0)
      store.ingest('high HAS score: 8')
      const selected = act(store, 'select', {})
      assert.equal(selected.ok, true, JSON.stringify(selected))
      assert.equal(query(store, 'high HAS selected-score: 8').length, 1)
      assert.equal(query(store, 'low HAS selected-score: ?n').length, 0)
      store.ingest('another HAS score: 9')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const ambiguous = act(store, 'select', {})
      assert.equal(ambiguous.ok, false)
      if (!ambiguous.ok) assert.match(ambiguous.error, /ambiguous binding/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    } finally { store.close() }
  }
})


test('new positive parameter metadata can clear and restore descriptions across actors', () => {
  const store = open()
  try {
    declareActions(store, 'action/review HAS action: `?service => ?service IS reviewed`')
    store.ingest('action/review/service IS param @src:first ; original description')
    assert.equal(listActions(store)[0]!.params[0]!.doc, 'original description')
    store.ingest('action/review/service IS param @src:second')
    assert.deepEqual(listActions(store)[0]!.params, [{ name: 'service' }])
    store.ingest('action/review/service IS param @src:third ; restored description')
    const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    assert.equal(listActions(store)[0]!.params[0]!.doc, 'restored description')
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    assert.equal(act(store, 'review', { service: 'api' }).ok, true)
    assert.equal(query(store, 'api IS reviewed').length, 1)
  } finally { store.close() }
})


test('effect and lineage write failures roll back the full action before hooks and allow retry', t => {
  for (const method of ['insertResult', 'appendEdges'] as const) {
    const store = open()
    try {
      store.ingest('api IS service')
      declareActions(store, 'action/review HAS action: `?service, ?service IS service => ?service IS reviewed, ?service HAS review-status: done`\naction/review HAS hook: notify')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const beforeEdges = store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all()
      let hookReads = 0
      const hooks = { get notify() { hookReads += 1; return 'node -e "process.stdout.write(\'notified\')"' } }
      const failure = new Error(`second ${method} failed after writing`)
      let writes = 0
      const afterWrite = (): void => { if (++writes === 2) throw failure }
      const insert = store.insertResult.bind(store)
      const edges = store.appendEdges.bind(store)
      const mocked = method === 'insertResult' ?
        t.mock.method(store, 'insertResult', (...args: Parameters<typeof insert>) => {
          const result = insert(...args)
          afterWrite()
          return result
        }) :
        t.mock.method(store, 'appendEdges', (...args: Parameters<typeof edges>) => {
          const result = edges(...args)
          afterWrite()
          return result
        })
      assert.throws(() => act(store, 'review', { service: 'api' }, { hooks }), error => error === failure)
      assert.equal(writes, 2)
      mocked.mock.restore()
      assert.equal(hookReads, 0, 'failed writes never reach the deferred hook lookup')
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all(), beforeEdges)
      const retried = act(store, 'review', { service: 'api' }, { hooks })
      assert.ok(retried.ok)
      assert.equal(retried.appended, 2)
      assert.equal(retried.hook?.output, 'notified')
      assert.equal(retried.hook?.error, undefined)
      assert.equal(hookReads, 1)
      for (const pattern of ['api IS reviewed', 'api HAS review-status: done']) {
        const row = query(store, pattern)[0]!.row!
        assert.deepEqual(store.edgesOf(row.id).map(edge => edge.role).sort(), ['BECAUSE', 'VIA'])
      }
      const unchanged = act(store, 'review', { service: 'api' }, { hooks })
      assert.ok(unchanged.ok)
      assert.equal(unchanged.unchanged, 2)
      assert.equal(hookReads, 1, 'an idempotent retry does not repeat the hook')
    } finally { store.close() }
  }
})

test('binary stored hook references roll back effects and lineage before configuration lookup and recover after repair', () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([110, 111, 116, 105, 102, 121])]) {
    const store = open()
    try {
      store.ingest('api IS service')
      declareActions(store, 'action/review HAS action: `?service, ?service IS service => ?service IS reviewed, ?service HAS review-status: done`\naction/review HAS hook: notify')
      const hookRow = store.db.prepare("SELECT id, value_text FROM cave_claim WHERE attribute = 'hook'").get()!
      assert.equal(typeof hookRow.id, 'string')
      assert.equal(typeof hookRow.value_text, 'string')
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(bytes, hookRow.id as string)
      const claims = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const edges = store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all()
      let lookups = 0
      const hooks = { get notify() { lookups++; return 'node -e "process.stdout.write(\'notified\')"' } }
      const expected = { name: 'TypeError', message: `stored action field "hook" value_text must be text (claim ${JSON.stringify(hookRow.id)})` }
      assert.throws(() => currentHook(store, 'action/review'), expected)
      assert.throws(() => listActions(store), expected)
      assert.throws(() => act(store, 'review', { service: 'api' }, { hooks }), expected)
      assert.equal(lookups, 0)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), claims)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge ORDER BY rowid').all(), edges)
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(hookRow.value_text as string, hookRow.id as string)
      const repaired = act(store, 'review', { service: 'api' }, { hooks })
      assert.ok(repaired.ok)
      assert.equal(repaired.appended, 2)
      assert.equal(repaired.hook?.output, 'notified')
      assert.equal(lookups, 1)
      for (const pattern of ['api IS reviewed', 'api HAS review-status: done']) {
        const row = query(store, pattern)[0]!.row!
        assert.deepEqual(store.edgesOf(row.id).map(edge => edge.role).sort(), ['BECAUSE', 'VIA'])
      }
      const after = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const repeated = act(store, 'review', { service: 'api' }, { hooks })
      assert.ok(repeated.ok)
      assert.equal(repeated.unchanged, 2)
      assert.equal(lookups, 1)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), after)
    } finally { store.close() }
  }
})

test('binary action bodies identify the stored row and allow read and execution recovery', () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([61, 62])]) {
    const store = open()
    try {
      declareActions(store, 'action/review HAS action: `=> api IS reviewed`')
      const row = store.db.prepare("SELECT id, value_text FROM cave_claim WHERE attribute = 'action'").get()!
      assert.equal(typeof row.id, 'string')
      assert.equal(typeof row.value_text, 'string')
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(bytes, row.id as string)
      const before = store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all()
      const expected = { name: 'TypeError', message: `stored action field "action" value_text must be text (claim ${JSON.stringify(row.id)})` }
      assert.throws(() => loadAction(store, 'review'), expected)
      assert.throws(() => listActions(store), expected)
      assert.throws(() => act(store, 'review'), expected)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_claim ORDER BY tx').all(), before)
      assert.deepEqual(store.db.prepare('SELECT * FROM cave_edge').all(), [])
      store.db.prepare('UPDATE cave_claim SET value_text = ? WHERE id = ?').run(row.value_text as string, row.id as string)
      assert.equal(loadAction(store, 'review')?.loaded?.action.name, 'review')
      assert.equal(listActions(store)[0]?.ok, true)
      const repaired = act(store, 'review')
      assert.ok(repaired.ok)
      assert.equal(repaired.appended, 1)
      const repeat = act(store, 'review')
      assert.ok(repeat.ok)
      assert.equal(repeat.unchanged, 1)
    } finally { store.close() }
  }
})
