import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Sensitivity, open } from '@cavelang/store'

test('labels form an ordered policy; unlabeled is internal and unknown fails closed (spec §9.7)', () => {
  assert.deepEqual(Sensitivity.levels, ['public', 'internal', 'confidential', 'restricted'])
  assert.equal(Sensitivity.ofTags([]), 'internal')
  assert.equal(Sensitivity.ofTags([{ key: 'sensitivity', value: 'public' }]), 'public')
  assert.equal(Sensitivity.ofTags([{ key: 'sensitivity', value: 'unknown' }]), 'restricted')
  assert.equal(Sensitivity.ofTags([{ key: 'sensitivity' }]), 'restricted')
  assert.equal(Sensitivity.ofTags([
    { key: 'sensitivity', value: 'public' },
    { key: 'sensitivity', value: 'confidential' }
  ]), 'confidential')
})

test('export defaults to internal and supports every explicit maximum (spec §9.7)', () => {
  const store = open()
  store.ingest([
    'public-item IS visible #sensitivity:public',
    'internal-item IS visible',
    'confidential-item IS visible #sensitivity:confidential',
    'restricted-item IS visible #sensitivity:restricted',
    'unknown-item IS visible #sensitivity:future-level',
    'flat-item IS visible #sensitivity',
    'mixed-item IS visible #sensitivity:public #sensitivity:confidential'
  ].join('\n'))

  const ordinary = store.exportText()
  assert.match(ordinary, /public-item/)
  assert.match(ordinary, /internal-item/)
  assert.doesNotMatch(ordinary, /confidential-item|restricted-item|unknown-item|flat-item|mixed-item/)

  const publicOnly = store.exportText({ maxSensitivity: 'public' })
  assert.match(publicOnly, /public-item/)
  assert.doesNotMatch(publicOnly, /internal-item|confidential-item|restricted-item|unknown-item|flat-item|mixed-item/)

  const confidential = store.exportText({ maxSensitivity: 'confidential' })
  for (const name of ['public-item', 'internal-item', 'confidential-item', 'mixed-item']) {
    assert.match(confidential, new RegExp(name))
  }
  assert.doesNotMatch(confidential, /restricted-item|unknown-item|flat-item/)

  const complete = store.exportText({ maxSensitivity: 'restricted' })
  for (const name of [
    'public-item', 'internal-item', 'confidential-item', 'restricted-item', 'unknown-item', 'flat-item', 'mixed-item'
  ]) {
    assert.match(complete, new RegExp(name))
  }
  store.close()
})

test('filtering happens after current-belief resolution and prunes hidden edges (spec §9.7)', () => {
  const store = open()
  store.ingest('service IS available #sensitivity:public\n  WHEN region IS eu #sensitivity:confidential')
  store.ingest('status HAS note: old #sensitivity:public')
  store.ingest('status HAS note: secret #sensitivity:confidential')

  const visible = store.exportText({ current: true, maxSensitivity: 'public' })
  assert.match(visible, /service IS available/)
  assert.doesNotMatch(visible, /WHEN|region|status HAS note/,
    'a hidden current row never revives an older public belief, and hidden edge children disappear')
  store.close()
})
