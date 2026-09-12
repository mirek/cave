import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

for (const lateWatch of [false, true]) test(`development server closes after cold-cache transforms${lateWatch ? ' and a shutdown hook adds a watched file' : ''}`, () => {
  const cache = mkdtempSync(join(tmpdir(), 'cave-vite-close-'))
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/vite-close-probe.mjs', import.meta.url))], {
      env: { ...process.env, CAVE_VITE_CACHE_DIR: cache, CAVE_VITE_LATE_WATCH: lateWatch ? '1' : '0' },
      encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL',
    })
    assert.equal(result.status, 0, `${result.error ?? result.signal ?? ''}\n${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout.trim())
    assert.equal(report.closed, true)
    assert.equal(report.checked.length, 5)
    assert.ok(report.checked.every((entry: { status: number }) => entry.status === 200))
  } finally { rmSync(cache, { recursive: true, force: true }) }
})
