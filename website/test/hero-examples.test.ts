import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { heroExamples } from '../src/hero-examples.ts'

// The homepage shows these outputs as real results, so replay each one
// through the workspace CLI against a fresh store.
const cli = fileURLToPath(new URL('../../packages/cli/src/main.ts', import.meta.url))
const cave = (cwd: string, args: readonly string[]): string =>
  execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1', CAVE_DB: '' },
  })

for (const example of heroExamples) {
  test(`homepage example "${example.key}" shows the CLI's real output`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-hero-'))
    try {
      writeFileSync(join(dir, example.file), `${example.code}\n`)
      cave(dir, [example.derive ? 'derive' : 'add', '--db', 'hero.db', example.file])
      for (const run of example.runs) {
        const output = cave(dir, ['query', '--db', 'hero.db', run.pattern, ...(run.flags ?? [])])
        assert.deepEqual(output.trimEnd().split('\n'), run.output, `${run.pattern} ${(run.flags ?? []).join(' ')}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('homepage examples have unique keys and fit the console', () => {
  assert.equal(new Set(heroExamples.map(example => example.key)).size, heroExamples.length)
  for (const example of heroExamples) {
    assert.ok(example.code.split('\n').length <= 9, `${example.key} has at most nine lines`)
    assert.ok(example.runs.length > 0)
  }
})
