import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Exercise only the actual registry helpers, never the publishing entrypoint.
const script = readFileSync(fileURLToPath(new URL('../../../scripts/release-publish.sh', import.meta.url)), 'utf8')
const start = script.indexOf('npm_view() {')
const end = script.indexOf('# Which public packages still need publishing?')
assert.ok(start >= 0 && end > start)
const helpers = script.slice(start, end)
const probe = (mode: string, env: Record<string, string> = {}, visibility = false) => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-registry-'))
  const count = join(dir, 'count')
  const sleeps = join(dir, 'sleeps')
  writeFileSync(count, '0')
  writeFileSync(sleeps, '')
  try {
    const result = spawnSync('bash', ['-c', `set -euo pipefail
npm() {
  local n
  n="$(cat "$TEST_COUNT")"
  n=$((n + 1))
  printf '%s' "$n" > "$TEST_COUNT"
  case "$TEST_MODE" in
    success) printf '%s' "$TEST_VALUE" ;;
    missing) echo 'npm error code E404' >&2; return 1 ;;
    transport) echo 'npm error ECONNRESET' >&2; return 1 ;;
    status-four) echo 'npm error transport failed' >&2; return 4 ;;
    diagnostic) printf '%s\\n' "$TEST_ERROR" >&2; return 1 ;;
    delayed) if [ "$n" -lt 3 ]; then echo 'npm error code E404' >&2; return 1; fi; printf '%s' "$TEST_VALUE" ;;
  esac
}
sleep() { printf '%s\\n' "$1" >> "$TEST_SLEEPS"; }
${helpers}
registry_has '@fixture/pkg@1.2.3' version '1.2.3' "$TEST_VISIBILITY"
`], {
      encoding: 'utf8',
      env: { ...process.env, CAVE_NPM_VIEW_ATTEMPTS: '4', CAVE_NPM_VIEW_RETRY_DELAY_SECONDS: '2',
        CAVE_NPM_VISIBILITY_ATTEMPTS: '8', CAVE_NPM_VISIBILITY_RETRY_DELAY_SECONDS: '5',
        TEST_MODE: mode, TEST_VALUE: '1.2.3', TEST_ERROR: '', TEST_VISIBILITY: String(visibility),
        TEST_COUNT: count.replaceAll('\\', '/'), TEST_SLEEPS: sleeps.replaceAll('\\', '/'), ...env }
    })
    return { ...result, calls: Number(readFileSync(count, 'utf8')), sleeps: readFileSync(sleeps, 'utf8').trim() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('registry probes distinguish confirmed absence from invalid successful replies', () => {
  assert.equal(probe('success').status, 0)
  const missing = probe('missing')
  assert.equal(missing.status, 1)
  assert.equal(missing.calls, 1)
  assert.equal(missing.sleeps, '')
  for (const TEST_VALUE of ['', '1.2.2', 'unparseable response']) {
    assert.equal(probe('success', { TEST_VALUE }).status, 2, 'unexpected output must not mean unpublished')
  }
})

test('registry transport failures cannot collide with the missing-package status', () => {
  const result = probe('status-four')
  assert.equal(result.calls, 4)
  assert.equal(result.status, 2)
})

test('registry probes retry transport errors and delayed post-publish visibility', () => {
  const transport = probe('transport')
  assert.equal(transport.status, 2)
  assert.equal(transport.calls, 4)
  assert.equal(transport.sleeps, '2\n4\n8')
  const delayed = probe('delayed', {}, true)
  assert.equal(delayed.status, 0)
  assert.equal(delayed.calls, 3)
  assert.equal(delayed.sleeps, '5\n10')
  const absent = probe('missing', {}, true)
  assert.equal(absent.status, 1)
  assert.equal(absent.calls, 8)
  assert.equal(absent.sleeps, '5\n10\n20\n40\n60\n60\n60')
  const zeroDelay = probe('transport', { CAVE_NPM_VIEW_ATTEMPTS: '02', CAVE_NPM_VIEW_RETRY_DELAY_SECONDS: '00' })
  assert.equal(zeroDelay.status, 2)
  assert.equal(zeroDelay.calls, 2)
  assert.equal(zeroDelay.sleeps, '0')
})

test('invalid retry settings fail before consulting the registry', () => {
  for (const CAVE_NPM_VIEW_ATTEMPTS of ['0', '-1', 'wat', '9007199254740992']) {
    const result = probe('success', { CAVE_NPM_VIEW_ATTEMPTS })
    assert.equal(result.status, 2)
    assert.equal(result.calls, 0)
  }
  for (const CAVE_NPM_VIEW_RETRY_DELAY_SECONDS of ['-1', '1.5', '61', 'wat']) {
    const result = probe('success', { CAVE_NPM_VIEW_RETRY_DELAY_SECONDS })
    assert.equal(result.status, 2)
    assert.equal(result.calls, 0)
  }
  const visibility = probe('success', { CAVE_NPM_VISIBILITY_ATTEMPTS: '0' }, true)
  assert.equal(visibility.status, 2)
  assert.equal(visibility.calls, 0)
})

test('only an unambiguous npm error-code line establishes package absence', () => {
  for (const TEST_ERROR of [
    'npm error code ECONNRESET\nnpm error request to https://registry.npmjs.org/@fixture%2fe404 failed',
    'npm error code EAUTH\nnpm error upstream diagnostic: 404 Not Found',
    'npm error code ECONNRESET\nnpm error unexpected response: is not in this registry',
    'npm error code E404\nnpm error code EAUTH',
    'npm error E404 package absent'
  ]) {
    const result = probe('diagnostic', { TEST_ERROR })
    assert.equal(result.status, 2, TEST_ERROR)
    assert.equal(result.calls, 4)
  }
  const legacy = probe('diagnostic', { TEST_ERROR: 'npm ERR! code E404' })
  assert.equal(legacy.status, 1)
  assert.equal(legacy.calls, 1)
})
