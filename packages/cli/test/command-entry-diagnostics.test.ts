import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { backupCommand, restoreCommand, suggestAliasCommand, reconstructCommand } from '@cavelang/cli'

for (const command of ['backup', 'restore', 'aliases', 'reconstruct'] as const) for (const kind of ['record', 'message'] as const) {
  test(`${command} returns a diagnostic for an unprintable ${kind} during file inspection`, async t => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'cave-entry-diagnostic-'))
    const source = join(directory, 'source.db')
    const restored = join(directory, 'restored.db')
    const store = open(source)
    store.ingest('api IS service')
    store.close()
    const failure = kind === 'record' ? Object.create(null) : new Error('hidden')
    if (kind === 'message') Object.defineProperty(failure, 'message', { get() { throw new Error('message unavailable') } })
    const invoke = () => command === 'backup' ? backupCommand(['--verify', source])
      : command === 'restore' ? restoreCommand([source, '--db', restored])
      : command === 'aliases' ? suggestAliasCommand(['--db', source])
      : reconstructCommand(['--db', source, 'api'])
    try {
      const before = fs.readFileSync(source)
      t.mock.method(fs, 'existsSync', () => { throw failure })
      syncBuiltinESMExports()
      assert.deepEqual(await invoke(), { code: 1, out: '', err: '[unprintable thrown value]\n' })
      t.mock.restoreAll()
      syncBuiltinESMExports()
      assert.deepEqual(fs.readFileSync(source), before)
      assert.equal(fs.existsSync(restored), false)
      const recovered = await invoke()
      assert.equal(recovered.code, 0, recovered.err)
      assert.notEqual(recovered.out, '')
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}
