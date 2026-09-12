import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { runEval } from '@cavelang/eval'

class Capture extends Writable {
  value = ''
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.value += String(chunk)
    done()
  }
}

for (const mode of ['active', 'absent', 'cancel-during-read'] as const) test(`evaluation command retains its initial signal: ${mode}`, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'cave-eval-command-signal-'))
  const golden = join(dir, 'source.golden.cave')
  fs.writeFileSync(join(dir, 'source.md'), 'A local fixture')
  fs.writeFileSync(golden, 'item IS retained')
  const original = new AbortController()
  const reason = new Error('initial evaluation signal cancelled')
  const replacement = mode === 'cancel-during-read' ? new AbortController().signal
    : AbortSignal.abort(new Error('replacement signal must not be used'))
  const stdout = new Capture(), stderr = new Capture()
  let reads = 0, goldenReads = 0
  try {
    if (mode === 'cancel-during-read') {
      const read = fs.readFileSync
      t.mock.method(fs, 'readFileSync', ((path, ...args) => {
        if (String(path) === golden) { goldenReads++; original.abort(reason) }
        return Reflect.apply(read, fs, [path, ...args])
      }) as typeof fs.readFileSync)
      syncBuiltinESMExports()
    }
    const pending = runEval([dir, '--stdout', '--agent', "printf 'item IS retained\\n'", '--json'], {
      stdout, stderr,
      get signal() { return ++reads === 1 ? mode === 'absent' ? undefined : original.signal : replacement }
    })
    if (mode === 'cancel-during-read') {
      await assert.rejects(pending, error => error === reason)
      assert.equal(goldenReads, 1)
      assert.equal(stdout.value, '')
    } else {
      assert.equal(await pending, 0)
      assert.equal(JSON.parse(stdout.value).okRuns, 1)
    }
    assert.equal(reads, 1)
    assert.equal(stderr.value, '')
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
