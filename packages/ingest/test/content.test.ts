import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { decodeText } from '../src/content.ts'

test('UTF-8 failures keep unusual source labels on one diagnostic line', () => {
  for (const path of ['line\nbreak', 'carriage\rreturn', 'tab\tname', 'escape\u001bname',
    'c1\u0085name', 'paragraph\u2029name', 'line\u2028name', 'quote"\\\nname']) {
    assert.throws(() => decodeText(Uint8Array.of(255), path), error => {
      assert.ok(error instanceof TypeError)
      assert.ok(error.cause instanceof TypeError)
      const suffix = ': invalid UTF-8 embedded source'
      assert.ok(error.message.endsWith(suffix))
      const label = error.message.slice(0, -suffix.length)
      assert.doesNotMatch(label, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
      assert.equal(JSON.parse(label), path)
      return true
    })
    assert.equal(decodeText(Uint8Array.of(111, 107), path), 'ok')
  }
  assert.throws(() => decodeText(Uint8Array.of(255), 'ordinary.md', 'instructions'),
    { message: 'ordinary.md: invalid UTF-8 instructions' })
})
