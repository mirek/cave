import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { Registry } from '@cavelang/canonical'
import { act, actProposal, declareActions, listActions, retractAction } from '@cavelang/act'

const claimCount = (store: ReturnType<typeof open>): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

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

test('declaration lifecycle — idempotent declare, list with docs, retract disables', () => {
  const store = open()
  const file = [
    '; deploy vocabulary',
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
