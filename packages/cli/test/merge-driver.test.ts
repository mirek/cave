import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from '@cavelang/store'
import { syncText } from '@cavelang/cli/sync'

const root = new URL('../../../', import.meta.url)

test('documented Git union driver preserves spaced paths and cleans up failed merges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave merge driver '))
  const store = open()
  try {
    const bin = join(dir, 'bin'), temporary = join(dir, 'temporary files')
    mkdirSync(bin)
    mkdirSync(temporary)
    writeFileSync(join(bin, 'cave'), '#!/bin/sh\nexec "$CAVE_TEST_NODE" "$CAVE_TEST_MAIN" "$@"\n', { mode: 0o755 })
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: temporary,
      CAVE_TEST_NODE: process.execPath, CAVE_TEST_MAIN: fileURLToPath(new URL('packages/cli/src/main.ts', root)) }
    store.ingest('api IS service')
    const ours = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    store.ingest('cache IS service')
    const theirs = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const paths = ['packages/sync/README.md', '.claude/skills/cave-storage-query/SKILL.md']
    for (const source of paths) {
      const markdown = readFileSync(new URL(source, root), 'utf8')
      const config = /```ini\n(\[merge "cave"\][\s\S]*?)\n```/u.exec(markdown)?.[1]
      assert.ok(config, `${source}: missing Git configuration`)
      const configPath = join(dir, 'gitconfig')
      writeFileSync(configPath, config)
      const parsed = spawnSync('git', ['config', '--file', configPath, '--get', 'merge.cave.driver'], { encoding: 'utf8' })
      assert.equal(parsed.status, 0, parsed.stderr)
      const a = join(dir, 'our claims.cave'), b = join(dir, 'their claims.cave')
      const command = parsed.stdout.trim().replaceAll('%A', a).replaceAll('%B', b)
      const run = () => spawnSync('sh', ['-c', command], { cwd: dir, env, encoding: 'utf8' })
      writeFileSync(a, ours)
      writeFileSync(b, theirs)
      const merged = run()
      assert.equal(merged.status, 0, `${source}: ${merged.stderr}`)
      assert.equal(readFileSync(a, 'utf8'), theirs)
      assert.deepEqual(readdirSync(temporary), [], 'successful merge removes its temporary database')
      writeFileSync(a, ours)
      writeFileSync(b, 'unannotated IS invalid')
      const failed = run()
      assert.notEqual(failed.status, 0)
      assert.equal(readFileSync(a, 'utf8'), ours, 'failed merge preserves our input')
      assert.deepEqual(readdirSync(temporary), [], 'failed merge removes its temporary database')
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('Git invokes the documented union driver for diverged branches and keeps invalid merges unresolved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave git merge '))
  const base = open(), left = open(), right = open(), merged = open()
  try {
    const bin = join(dir, 'bin'), temporary = join(dir, 'temporary files')
    mkdirSync(bin)
    mkdirSync(temporary)
    writeFileSync(join(bin, 'cave'), '#!/bin/sh\nexec "$CAVE_TEST_NODE" "$CAVE_TEST_MAIN" "$@"\n', { mode: 0o755 })
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      PATH: `${bin}:${process.env.PATH}`, TMPDIR: temporary, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      CAVE_TEST_NODE: process.execPath, CAVE_TEST_MAIN: fileURLToPath(new URL('packages/cli/src/main.ts', root)) }
    base.ingest('api IS service')
    const seed = base.exportText({ tx: true, maxSensitivity: 'restricted' })
    syncText(left, seed, { record: false })
    syncText(right, seed, { record: false })
    left.ingest('cache IS service')
    right.ingest('worker IS service')
    const ours = left.exportText({ tx: true, maxSensitivity: 'restricted' })
    const theirs = right.exportText({ tx: true, maxSensitivity: 'restricted' })
    const readme = readFileSync(new URL('packages/sync/README.md', root), 'utf8')
    const config = /```ini\n(\[merge "cave"\][\s\S]*?)\n```/u.exec(readme)?.[1]
    assert.ok(config)
    for (const valid of [true, false]) {
      const repo = join(dir, valid ? 'valid repo' : 'invalid repo')
      mkdirSync(repo)
      const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=CAVE test', '-c', 'user.email=cave@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env, encoding: 'utf8' })
      const checked = (...args: string[]) => {
        const result = git(...args)
        assert.equal(result.status, 0, result.stdout + result.stderr)
        return result.stdout
      }
      checked('init', '-b', 'main')
      writeFileSync(join(repo, '.git', 'cave-driver'), config)
      checked('config', 'include.path', 'cave-driver')
      writeFileSync(join(repo, '.gitattributes'), '*.cave merge=cave\n')
      const path = join(repo, 'knowledge with spaces.cave')
      writeFileSync(path, seed)
      checked('add', '.')
      checked('commit', '-m', 'Base replica')
      checked('checkout', '-b', 'other')
      writeFileSync(path, valid ? theirs : 'unannotated IS invalid\n')
      checked('commit', '-am', 'Other branch')
      checked('checkout', 'main')
      writeFileSync(path, ours)
      checked('commit', '-am', 'Our branch')
      const result = git('merge', '--no-edit', 'other')
      if (valid) {
        assert.equal(result.status, 0, result.stdout + result.stderr)
        assert.equal(checked('ls-files', '-u'), '')
        assert.equal(checked('rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3)
        const report = syncText(merged, readFileSync(path, 'utf8'), { record: false })
        assert.deepEqual(report.problems, [])
        const ids = (store: ReturnType<typeof open>) => store.currentBeliefs().map(row => row.id)
        assert.deepEqual(new Set(ids(merged)), new Set([...ids(left), ...ids(right)]))
      } else {
        assert.notEqual(result.status, 0)
        assert.equal(readFileSync(path, 'utf8'), ours)
        assert.equal(checked('ls-files', '-u').trim().split('\n').length, 3)
      }
      assert.deepEqual(readdirSync(temporary), [], 'Git-driven merges clean up temporary databases')
    }
  } finally { base.close(); left.close(); right.close(); merged.close(); rmSync(dir, { recursive: true, force: true }) }
})
