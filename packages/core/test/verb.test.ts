import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Verb } from '@cavelang/core'

test('verb token shape follows the normative uppercase atom', () => {
  assert.equal(Verb.isVerbToken('USES'), true)
  assert.equal(Verb.isVerbToken('RENAMED-TO'), true)
  assert.equal(Verb.isVerbToken('USES-'), true)
  assert.equal(Verb.isVerbToken('uses'), false)
  assert.equal(Verb.isVerbToken('-USES'), false)
})

test('verb tokens require actual end of input, not a terminal line separator', () => {
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    assert.equal(Verb.isVerbToken(`USES${suffix}`), false, JSON.stringify(suffix))
  }
})
