import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string): string =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

test('reviewed incident example wording stays corrected', () => {
  const incident = read('examples/incident/incident.md')
  assert.match(incident, /the payments service goes through the auth gateway/)
  assert.doesNotMatch(incident, /payments goes through/)

  const examples = read('examples/README.md')
  assert.match(examples, /its hand extraction\s+into CAVE/)
  assert.doesNotMatch(examples, /its hand extraction\s+to CAVE/)
})
