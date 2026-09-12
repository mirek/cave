import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { jsonValueEnds } from '@cavelang/loop'
import { parsePairs } from '@cavelang/eval'

test('judge syntax indexing agrees with native JSON on nested values and damaged arrays', () => {
  const fixtures = [
    '[]', '[1,-2,0,-0,1.001,1e+30,1e-20,1e400]',
    '[true,false,null,{"key":[1,2],"other":{"nested":[]}}]',
    '["quote\\\"", "slash\\\\", "\\u0000", "\\n\\t", "[brackets]"]',
    '[[1,1], {"key": "value"}, [2,2]]',
  ]
  const check = (source: string) => {
    let valid = true
    try { JSON.parse(source) } catch { valid = false }
    assert.equal(jsonValueEnds(source)[0] === source.length, valid, JSON.stringify(source))
  }
  for (const fixture of fixtures) {
    check(fixture)
    for (let at = 1; at < fixture.length - 1; at++) {
      for (const replacement of ['', 'x', '"', '\\', ',', '\n', '0']) {
        check(fixture.slice(0, at) + replacement + fixture.slice(at + 1))
      }
    }
  }
})

test('deep malformed judge replies recover a final answer without decoding overlapping candidates', t => {
  const original = JSON.parse
  let decoded = 0
  const mock = t.mock.method(JSON, 'parse', ((source: string) => {
    decoded += source.length
    return original(source)
  }) as typeof JSON.parse)
  try {
    const reply = '['.repeat(20000) + 'invalid' + ']'.repeat(20000) + '\n[[1,1]]'
    assert.deepEqual(parsePairs(reply, 1, 1), [[0, 0]])
    assert.equal(decoded, '[[1,1]]'.length)
    const valid = '['.repeat(20000) + '0' + ']'.repeat(20000)
    assert.deepEqual(parsePairs(valid, 1, 1), [])
    assert.equal(decoded, '[[1,1]]'.length + valid.length)
  } finally { mock.mock.restore() }
})
