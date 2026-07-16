import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { open } from '@cavelang/store'

const writer = fileURLToPath(new URL('multi-process-writer.ts', import.meta.url))

test('an already-open slow-clock writer appends after a fast-clock peer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-multi-writer-'))
  try {
    const path = join(dir, 'shared.db')
    const slow = spawn(process.execPath, [
      '--disable-warning=ExperimentalWarning', writer, path, 'slow', '1000000000000', 'wait'
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    slow.stdout.setEncoding('utf8')
    slow.stderr.setEncoding('utf8')
    let slowError = ''
    slow.stderr.on('data', chunk => { slowError += chunk })
    const [ready] = await once(slow.stdout, 'data')
    assert.equal(ready, 'ready\n')

    const fast = spawn(process.execPath, [
      '--disable-warning=ExperimentalWarning', writer, path, 'fast', '2000000000000', 'hold'
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    fast.stdout.setEncoding('utf8')
    fast.stderr.setEncoding('utf8')
    let fastError = ''
    fast.stderr.on('data', chunk => { fastError += chunk })
    const [locked] = await once(fast.stdout, 'data')
    assert.equal(locked, 'locked\n')

    slow.stdin.end('write\n')
    setTimeout(() => fast.stdin.end('commit\n'), 100)
    const [[fastCode], [slowCode]] = await Promise.all([once(fast, 'exit'), once(slow, 'exit')])
    assert.equal(fastCode, 0, fastError)
    assert.equal(slowCode, 0, slowError)

    const store = open(path)
    const current = store.currentBeliefs().find(row => row.attribute === 'state')
    assert.equal(current?.value_text, 'slow', 'the later committed write is current')
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
