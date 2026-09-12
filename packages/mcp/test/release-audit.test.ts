import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { auditPublishedPackages } = await import(new URL('../../../scripts/release-audit.mjs', import.meta.url).href)

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cave-audit-test-'))
  for (const [directory, manifest] of Object.entries({
    core: { name: '@cavelang/core', version: '1.2.3' },
    parser: { name: '@cavelang/parser', version: '1.2.4-beta.1' },
    mcp: { name: '@cavelang/mcp', version: '1.2.3', private: true },
  })) {
    mkdirSync(join(root, 'packages', directory), { recursive: true })
    writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify(manifest))
  }
  return root
}

test('publication audit installs only exact public versions in an isolated directory', () => {
  const root = fixture()
  const original = readFileSync(join(root, 'packages/core/package.json'), 'utf8')
  const calls: string[][] = []
  let temporary = ''
  try {
    auditPublishedPackages(root, (args: string[], cwd: string) => {
      if (temporary) assert.equal(cwd, temporary)
      temporary = cwd
      assert.notEqual(cwd, root)
      const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
      assert.deepEqual(manifest.dependencies, { '@cavelang/core': '1.2.3', '@cavelang/parser': '1.2.4-beta.1' })
      assert.equal(manifest.private, true)
      calls.push(args)
    })
    assert.deepEqual(calls, [
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--include=prod', '--include=optional'],
      ['ls', '--depth=0'], ['audit', 'signatures'],
    ])
    assert.equal(existsSync(temporary), false)
    assert.equal(readFileSync(join(root, 'packages/core/package.json'), 'utf8'), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const failAt of ['install', 'ls', 'audit']) {
  test(`publication audit propagates ${failAt} failure and cleans its installation`, () => {
    const root = fixture()
    let temporary = ''
    const calls: string[] = []
    try {
      assert.throws(() => auditPublishedPackages(root, (args: string[], cwd: string) => {
        temporary = cwd
        calls.push(args[0]!)
        if (args[0] === failAt) throw new Error('fixture failure')
      }), /fixture failure/)
      assert.equal(calls.at(-1), failAt)
      assert.equal(existsSync(temporary), false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test('publication audit rejects dependency selectors before invoking npm', () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'packages/core/package.json'), JSON.stringify({ name: '@cavelang/core', version: '^1.2.3' }))
    assert.throws(() => auditPublishedPackages(root, () => assert.fail('npm must not run')), /Invalid public package identity/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const operationFails of [false, true]) for (const unprintable of [false, true]) test(`publication audit retains cleanup failure after operation failure=${operationFails}, unprintable=${unprintable}`, () => {
  const root = fixture()
  const operationError = unprintable ? Object.create(null) : new Error('signature verification failed')
  const cleanupError = unprintable ? Object.create(null) : new Error('temporary installation removal failed')
  let temporary = '', removals = 0
  try {
    assert.throws(() => auditPublishedPackages(root, (args: string[], cwd: string) => {
      temporary = cwd
      if (operationFails && args[0] === 'audit') throw operationError
    }, (directory: string, options: unknown) => {
      removals++
      assert.equal(directory, temporary)
      assert.deepEqual(options, { recursive: true, force: true })
      throw cleanupError
    }), error => {
      if (operationFails) {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, [operationError, cleanupError])
        assert.equal(error.cause, operationError)
        if (unprintable) assert.equal(error.message, '[unprintable thrown value]; temporary installation cleanup also failed: [unprintable thrown value]')
        else assert.match(error.message, /signature verification failed.*cleanup also failed.*removal failed/)
      } else assert.equal(error, cleanupError)
      return true
    })
    assert.equal(removals, 1)
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
