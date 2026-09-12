import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Language } from 'web-tree-sitter'
import { highlighter } from '@cavelang/highlight'

test('failed grammar initialization can recover while concurrent requests share one load', async t => {
  const original = Language.load
  let attempts = 0
  t.mock.method(Language, 'load', async (...args: Parameters<typeof Language.load>) => {
    attempts++
    if (attempts === 1) throw new Error('temporary grammar failure')
    return original.apply(Language, args)
  })
  const failed = highlighter()
  assert.equal(highlighter(), failed)
  await assert.rejects(failed, /temporary grammar failure/)
  const recovered = highlighter()
  assert.notEqual(recovered, failed)
  assert.equal(highlighter(), recovered)
  const instance = await recovered
  assert.ok(instance.spans('a IS b').some(span => span.capture === 'keyword'))
  assert.equal(await highlighter(), instance)
  assert.equal(attempts, 2)
})
