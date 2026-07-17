import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const validator = fileURLToPath(new URL('../../../scripts/release-validate.mjs', import.meta.url))

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const writeVersions = (root: string, version: string): void => {
  const rootManifest = { name: 'fixture', version, private: true }
  const packageManifest = { name: '@fixture/public', version }
  const grammarManifest = { name: '@fixture/grammar', version }
  mkdirSync(join(root, 'packages/public'), { recursive: true })
  mkdirSync(join(root, 'packages/tree-sitter-cave'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(rootManifest, null, 2)}\n`)
  writeFileSync(join(root, 'packages/public/package.json'), `${JSON.stringify(packageManifest, null, 2)}\n`)
  writeFileSync(join(root, 'packages/tree-sitter-cave/package.json'), `${JSON.stringify(grammarManifest, null, 2)}\n`)
  writeFileSync(join(root, 'packages/tree-sitter-cave/tree-sitter.json'),
    `${JSON.stringify({ metadata: { version } }, null, 2)}\n`)
}

const fixture = (): { root: string, cleanup: () => void } => {
  const parent = mkdtempSync(join(tmpdir(), 'cave-release-'))
  const root = join(parent, 'repo')
  const remote = join(parent, 'origin.git')
  mkdirSync(root)
  git(root, 'init', '--initial-branch=main')
  git(root, 'config', 'user.name', 'Release Test')
  git(root, 'config', 'user.email', 'release@example.test')
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })
  writeVersions(root, '1.2.2')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'previous release')
  writeVersions(root, '1.2.3')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'version packages')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'push', '-u', 'origin', 'main')
  return { root, cleanup: () => rmSync(parent, { recursive: true, force: true }) }
}

const validate = (root: string, ...args: string[]) => spawnSync(process.execPath, [validator, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    CAVE_RELEASE_ROOT: root,
    GITHUB_ACTIONS: '',
    GITHUB_REF: '',
    GITHUB_SHA: ''
  }
})

test('release preflight accepts only an authoritative version commit and matching tag', async t => {
  await t.test('accepts the committed version-introducing main commit', () => {
    const { root, cleanup } = fixture()
    try {
      const result = validate(root)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /release preflight ok: v1\.2\.3/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects a later same-version commit when the tag is missing', () => {
    const { root, cleanup } = fixture()
    try {
      writeFileSync(join(root, 'README.md'), 'later change\n')
      git(root, 'add', 'README.md')
      git(root, 'commit', '-m', 'later change')
      git(root, 'push', 'origin', 'main')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /v1\.2\.3 cannot be released from .* rerun the workflow for version commit/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects a version tag that points at different code', () => {
    const { root, cleanup } = fixture()
    try {
      git(root, 'tag', 'v1.2.3', 'HEAD^')
      git(root, 'push', 'origin', 'v1.2.3')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /v1\.2\.3 points to .* not version commit/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects uncommitted version source changes', () => {
    const { root, cleanup } = fixture()
    try {
      writeVersions(root, '9.9.9')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /version sources differ from their committed contents/)
    } finally {
      cleanup()
    }
  })
})
