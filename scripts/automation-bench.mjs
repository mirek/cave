/** Rule → automation → action throughput with correctness and quiet-cycle checks. */
import * as assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { declareRules } from '../packages/rules/src/index.ts'
import { act, declareActions } from '../packages/act/src/index.ts'
import { declareAutomations, settle, settled } from '../packages/automate/src/index.ts'
import { query } from '../packages/query/src/index.ts'
import { evaluate } from '../packages/shape/src/index.ts'

const arguments_ = process.argv.slice(2)
assert.ok(arguments_.every(argument => ['--shapes', '--large', '--repeat'].includes(argument)) &&
  new Set(arguments_).size === arguments_.length,
  'usage: automation-bench.mjs [--shapes] [--large] [--repeat]')
const shapes = arguments_.includes('--shapes')
const large = arguments_.includes('--large')
const repeat = arguments_.includes('--repeat')

console.log(JSON.stringify({ format: 'cave.automation-benchmark', version: 1, shapes, large, repeat, runtime: {
  node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch
} }))
for (const events of large ? [1_000, 2_000, 4_000] : [100, 500, 1_000]) {
  const store = open()
  try {
    declareRules(store, '?x IS incoming => ?x IS ready')
    if (shapes) store.ingest('handled EXPECTS owner #cardinality:one', { strict: true })
    declareActions(store, shapes
      ? 'action/handle HAS action: `?x => ?x IS handled, ?x HAS owner: benchmark`'
      : 'action/handle HAS action: `?x => ?x IS handled`')
    declareAutomations(store, 'automation/handle HAS automation: `?x IS ready => action/handle`')
    const claims = Array.from({ length: events }, (_, index) => `event/${index} IS incoming`).join('\n')
    console.log(JSON.stringify({ events, phase: 'start' }))
    store.ingest(claims, { strict: true })
    const started = performance.now()
    const report = await settle(store)
    const settleMs = performance.now() - started
    assert.ok(settled(report), JSON.stringify(report))
    assert.equal(report.automations.find(item => item.subject === 'automation/handle')?.fired, events)
    for (const state of ['ready', 'handled']) {
      const matches = query(store, `?x IS ${state}`)
      assert.equal(matches.length, events, state)
      assert.deepEqual(matches.map(match => match.bindings.x).sort(), Array.from({ length: events }, (_, index) => `event/${index}`).sort(), state)
    }
    if (shapes) {
      const shape = evaluate(store)
      assert.equal(shape.expectations.length, 1)
      assert.equal(shape.checks, events)
      assert.equal(shape.violations.length, 0)
      assert.deepEqual(query(store, '?x HAS owner: benchmark').map(match => match.bindings.x).sort(),
        Array.from({ length: events }, (_, index) => `event/${index}`).sort())
    }
    const rows = () => store.db.prepare('SELECT COUNT(*) AS count FROM cave_claim').get().count
    const before = rows()
    const quietStarted = performance.now()
    const quiet = await settle(store)
    const quietMs = performance.now() - quietStarted
    assert.ok(settled(quiet), JSON.stringify(quiet))
    assert.equal(quiet.automations.reduce((sum, item) => sum + item.fired, 0), 0)
    assert.equal(rows(), before, 'a quiet cycle must append no rows')
    console.log(JSON.stringify({ events, phase: 'complete', settleMs, quietMs, passes: report.passes,
      derived: report.derive, storedRows: before, fired: events, shapeChecks: shapes ? events : 0, quietWrites: 0 }))
    if (repeat) {
      const repeatStarted = performance.now()
      for (let index = 0; index < events; index++) {
        const result = act(store, 'handle', { x: `event/${index}` })
        assert.ok(result.ok && result.appended === 0 && result.updated === 0 &&
          result.unchanged === (shapes ? 2 : 1), JSON.stringify(result))
      }
      const repeatMs = performance.now() - repeatStarted
      assert.equal(rows(), before, 'repeated idempotent actions must append no rows')
      console.log(JSON.stringify({ events, phase: 'repeat', repeatMs, repeatedActions: events, repeatWrites: 0 }))
    }
  } finally {
    store.close()
  }
}
