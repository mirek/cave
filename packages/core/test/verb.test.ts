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
