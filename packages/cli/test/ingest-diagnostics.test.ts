import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from '@cavelang/store'

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))

test('ingestion CLI retains escaped setup diagnostics and permits unchanged planning retries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-diagnostics-'))
  const db = join(dir, 'knowledge.db')
  const source = join(dir, 'source.md')
  const seed = open(db)
  seed.ingest('existing IS retained')
  seed.close()
  const history = () => {
    const store = open(db, { access: 'read-only' })
    try { return store.exportText({ tx: true, maxSensitivity: 'restricted' }) }
    finally { store.close() }
  }
  try {
    writeFileSync(source, 'source material')
    const before = history()
    for (const debug of ['0', '1']) {
      const instructions = join(dir, `missing-${debug}\n\u001binstructions.md`)
      const invoke = () => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', main,
        'ingest', source, '--db', db, '--plan', '--instructions', instructions], {
        encoding: 'utf8', env: { ...process.env, CAVE_DEBUG: debug }, timeout: 10_000
      })
      const failed = invoke()
      assert.equal(failed.error, undefined)
      assert.equal(failed.status, 1)
      assert.equal(failed.stdout, '')
      assert.match(failed.stderr.split('\n')[0]!, /cannot read instructions.*ENOENT/)
      assert.match(failed.stderr, /\\n\\u001b/)
      assert.ok(!failed.stderr.includes(instructions))
      assert.doesNotMatch(failed.stderr, /\u001b/)
      assert.equal(history(), before)
      writeFileSync(instructions, 'Extract the source faithfully.')
      const corrected = invoke()
      assert.equal(corrected.error, undefined)
      assert.equal(corrected.status, 0, corrected.stderr)
      assert.notEqual(corrected.stdout, '')
      assert.equal(corrected.stderr, '')
      assert.equal(history(), before)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
