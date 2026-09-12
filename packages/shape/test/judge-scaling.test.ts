import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { parseJudgeReply } from '@cavelang/shape'

test('deep malformed alias replies do not repeatedly decode overlapping candidates', t => {
  const original = JSON.parse
  let decoded = 0
  const mock = t.mock.method(JSON, 'parse', ((source: string) => {
    decoded += source.length
    return original(source)
  }) as typeof JSON.parse)
  try {
    const reply = '['.repeat(20000) + 'invalid' + ']'.repeat(20000) + '\n[1]'
    assert.deepEqual(parseJudgeReply(reply, 1), [0])
    assert.equal(decoded, '[1]'.length)
    const valid = '['.repeat(20000) + '0' + ']'.repeat(20000)
    assert.deepEqual(parseJudgeReply(valid, 1), [])
    assert.equal(decoded, '[1]'.length + valid.length)
  } finally { mock.mock.restore() }
})
