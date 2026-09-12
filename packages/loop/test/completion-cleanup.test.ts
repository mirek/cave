import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { shellComplete } from '../src/llm.ts'

for (const phase of ['write', 'unprintable write', 'process', 'cancelled', 'success'] as const) {
  test(`shell completion retains ${phase} outcome when prompt cleanup fails`, async t => {
    const write = fs.writeFileSync
    const remove = fs.rmSync
    const workFailure = phase === 'unprintable write' ? Object.create(null) : new Error('prompt write failed')
    const cleanupFailure = new Error('prompt cleanup failed')
    const removed: string[] = []
    const controller = new AbortController()
    t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
      write(...args)
      if (phase === 'cancelled') controller.abort()
      if (phase === 'write' || phase === 'unprintable write') throw workFailure
    })
    t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
      remove(...args)
      removed.push(String(args[0]))
      throw cleanupFailure
    })
    syncBuiltinESMExports()
    try {
      const command = phase === 'process' ? 'node -e "process.exit(7)" {prompt-file}' :
        'node -e "process.stdout.write(\'ok\')" {prompt-file}'
      await assert.rejects(shellComplete(command, { signal: controller.signal })('prompt'), error => {
        if (phase === 'success') assert.equal(error, cleanupFailure)
        else {
          assert.ok(error instanceof AggregateError)
          assert.equal(error.errors.length, 2)
          assert.equal(error.errors[1], cleanupFailure)
          assert.equal(error.cause, error.errors[0])
          if (phase === 'cancelled') assert.equal(error.errors[0].kind, 'aborted')
          else if (phase === 'process') assert.equal(error.errors[0].message, 'agent exited with 7')
          else assert.equal(error.errors[0], workFailure)
          assert.match(error.message, /prompt cleanup failed/)
          assert.match(error.message, phase === 'cancelled' ? /process was cancelled/ : phase === 'process' ? /agent exited with 7/ :
            phase === 'write' ? /prompt write failed/ : /unprintable/)
        }
        return true
      })
      assert.equal(removed.length, 1)
      assert.equal(fs.existsSync(removed[0]!), false)
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    }
    assert.equal(await shellComplete('node -e "process.stdout.write(\'recovered\')" {prompt-file}')('prompt'), 'recovered')
  })
}
