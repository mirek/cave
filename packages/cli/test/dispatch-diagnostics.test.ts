import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Readable } from 'node:stream'
import { dispatch } from '@cavelang/cli'

for (const debug of [false, true]) for (const kind of ['record', 'message', 'stack throws', 'stack changes', 'stack object', 'ordinary'] as const) {
  test(`dispatcher retains ${kind} diagnostics with debug=${debug}`, async t => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const stdin = Readable.from([])
    let diagnostic = ''
    stderr.on('data', chunk => { diagnostic += String(chunk) })
    const failure = kind === 'record' ? Object.create(null) : new Error('work failed')
    let stackReads = 0
    if (kind === 'message') Object.defineProperty(failure, 'message', { get() { throw new Error('message unavailable') } })
    if (kind === 'stack throws' || kind === 'stack changes') Object.defineProperty(failure, 'stack', {
      get() {
        stackReads++
        if (kind === 'stack changes' && stackReads === 1) return 'captured stack'
        throw new Error('stack unavailable')
      },
    })
    if (kind === 'stack object') Object.defineProperty(failure, 'stack', { value: Object.create(null) })
    if (kind === 'ordinary') Object.defineProperty(failure, 'stack', { value: 'ordinary stack' })
    try {
      t.mock.method(stdout, 'write', () => { throw failure })
      assert.equal(await dispatch(['version'], { stdin, stdout, stderr, debug }), 1)
      const expected = kind === 'record' || kind === 'message' ? '[unprintable thrown value]'
        : debug && kind === 'stack changes' ? 'captured stack'
        : debug && kind === 'ordinary' ? 'ordinary stack' : 'work failed'
      assert.equal(diagnostic, `cave version: ${expected}\n`)
      if (kind === 'stack throws' || kind === 'stack changes') assert.equal(stackReads, debug ? 1 : 0)
      t.mock.restoreAll()
      diagnostic = ''
      assert.equal(await dispatch(['version'], { stdin, stdout, stderr, debug }), 0)
      assert.equal(diagnostic, '')
      assert.match(String(stdout.read()), /\d+\.\d+\.\d+/)
    } finally {
      t.mock.restoreAll()
      stdin.destroy()
      stdout.destroy()
      stderr.destroy()
    }
  })
}
