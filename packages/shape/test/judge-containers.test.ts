import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { parseJudgeReply } from '@cavelang/shape'

test('judge replies do not promote arrays inside complete JSON strings or objects', () => {
  for (const text of ['"[1]"', '{"rejected":[1]}', '{"reason":"not [1]"}',
    '{"nested":{"accepted":[1]}}', JSON.stringify('escaped " [1] \\ text')]) {
    assert.deepEqual(parseJudgeReply(text, 3), [], text)
    assert.deepEqual(parseJudgeReply(`[2] then ${text}`, 3), [1], text)
    assert.deepEqual(parseJudgeReply(`${text} then [3]`, 3), [2], text)
  }
})
