import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { open } from '@cavelang/store'
import { declareAutomations, settle, watchCycle } from '@cavelang/automate'
import { runAutomate } from '../src/main.ts'
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

test('automate --declare wins over --list and still opens the store for writing (spec §13.7)', async () => {
  class Capture extends Writable {
    value = ''

    override _write(chunk: Buffer | string, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
      this.value += String(chunk)
      done()
    }
  }
  const capture = (): Capture => new Capture()
  const dir = mkdtempSync(join(tmpdir(), 'cave-automate-main-'))
  try {
    const db = join(dir, 'k.db')
    const file = join(dir, 'automations.cave')
    writeFileSync(file, 'automation/watch HAS automation: `?x IS hot => hook/log`\n')
    const stdout = capture()
    const stderr = capture()
    const code = await runAutomate(['--db', db, '--declare', file, '--list'], { stdout, stderr })
    assert.equal(code, 0, stderr.value)
    assert.match(stdout.value, /declared 1 automation\(s\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
