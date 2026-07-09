import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Score, judgePrompt, parsePairs } from '@cavelang/eval'

const facts = (text: string): readonly Score.Fact[] =>
  Score.goldenFacts(text).facts

test('the judge prompt lists G/P-labelled canonical lines and the reply contract', () => {
  const prompt = judgePrompt(
    facts('maria PARENT-OF anna\njan HAS birthplace: Kraków'),
    facts('grandma-maria PARENT-OF anna')
  )
  assert.match(prompt, /G1: maria PARENT-OF anna/)
  assert.match(prompt, /G2: jan HAS birthplace: Kraków/)
  assert.match(prompt, /P1: grandma-maria PARENT-OF anna/)
  assert.match(prompt, /ONLY a JSON array/)
})

test('parsePairs: bare, fenced and prose-wrapped arrays; last answer wins', () => {
  assert.deepEqual(parsePairs('[[1, 2], [3, 1]]', 3, 2), [[0, 1], [2, 0]])
  assert.deepEqual(parsePairs('Answer:\n```json\n[[2, 1]]\n```\n', 2, 1), [[1, 0]])
  assert.deepEqual(parsePairs('I compared [several] options before deciding.\n[[1, 1]]', 1, 1), [[0, 0]])
  assert.deepEqual(parsePairs('first guess [[1, 1]] — no, actually []', 1, 1), [])
  assert.deepEqual(parsePairs('[]', 1, 1), [])
})

test('parsePairs: out-of-range, duplicate and malformed entries are dropped', () => {
  assert.deepEqual(parsePairs('[[1, 1], [1, 2], [9, 1], [2, "x"], [2], [2, 2]]', 2, 2), [[0, 0], [1, 1]])
  assert.deepEqual(parsePairs('no array here', 2, 2), [])
  assert.deepEqual(parsePairs('{"pairs": [[1, 1]]}', 2, 2), [[0, 0]], 'the inner array still parses')
  assert.deepEqual(parsePairs('[0, 1]', 2, 2), [], 'indices are 1-based; a flat pair is not a pair list')
})
