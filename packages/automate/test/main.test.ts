import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { open } from '@cavelang/store'
import { declareAutomations, settle, watchCycle } from '@cavelang/automate'
import type { SettleReport } from '@cavelang/automate'

const maxTxOf = (store: ReturnType<typeof open>): null | string =>
  (store.db.prepare('SELECT MAX(tx) AS t FROM cave_claim').get() as { t: null | string }).t

const firedOf = (report: SettleReport, subject: string): number =>
  report.automations.find(automation => automation.subject === subject)?.fired ?? 0

test('a write landing during a cycle is settled by that cycle, never marked seen unprocessed (BUGS.md watch-watermark-race, spec §29.5)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
  store.ingest('api IS hot')

  // The concurrent write lands inside the cycle — after a settle's final
  // read, before the poll boundary is taken — exactly the daemon's race
  // window (rendering happens there too).
  const reports: SettleReport[] = []
  let injected = false
  const seen = await watchCycle(store, {}, report => {
    reports.push(report)
    if (!injected) {
      injected = true
      store.ingest('web IS hot')
    }
  })

  const fired = reports.reduce((sum, report) => sum + firedOf(report, 'automation/watch'), 0)
  assert.equal(fired, 2, 'both events fired within the cycle')

  // The poll wakes only when MAX(tx) moves past `seen`, so a boundary
  // equal to MAX(tx) must leave nothing pending — otherwise the write is
  // missed until an unrelated later write arrives.
  assert.equal(seen, maxTxOf(store))
  const pending = await settle(store)
  assert.equal(firedOf(pending, 'automation/watch'), 0, 'nothing was marked seen without being processed')
  store.close()
})

test('a cycle failure propagates, and a retried cycle converges (spec §29.5)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')
  store.ingest('api IS hot')

  // The daemon must see the failure (it keeps `seen` put and retries on
  // the next tick) rather than have the loop swallow it.
  await assert.rejects(
    watchCycle(store, {}, () => { throw new Error('render failed') }),
    /render failed/)

  const reports: SettleReport[] = []
  const seen = await watchCycle(store, {}, report => reports.push(report))
  assert.equal(seen, maxTxOf(store), 'the retry reaches a stable boundary')
  assert.ok(reports.every(report => firedOf(report, 'automation/watch') === 0),
    'the pre-failure settle already fired and marked its watermark — retries never re-notify (spec §29.3)')
  store.close()
})

test('a quiet cycle reports once and returns a stable boundary (spec §29.5)', async () => {
  const store = open()
  declareAutomations(store, 'automation/watch HAS automation: `?x IS hot => hook/log`')

  const reports: SettleReport[] = []
  const seen = await watchCycle(store, {}, report => reports.push(report))
  assert.equal(reports.length, 1, 'nothing new — one settle confirms quiescence')
  assert.equal(firedOf(reports[0]!, 'automation/watch'), 0)
  assert.equal(seen, maxTxOf(store))
  store.close()
})
