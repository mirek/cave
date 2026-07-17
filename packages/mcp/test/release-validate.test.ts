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
  mkdirSync(join(root, 'editors/vscode'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(rootManifest, null, 2)}\n`)
  writeFileSync(join(root, 'packages/public/package.json'), `${JSON.stringify(packageManifest, null, 2)}\n`)
  writeFileSync(join(root, 'packages/tree-sitter-cave/package.json'), `${JSON.stringify(grammarManifest, null, 2)}\n`)
  writeFileSync(join(root, 'packages/tree-sitter-cave/tree-sitter.json'),
    `${JSON.stringify({ metadata: { version } }, null, 2)}\n`)
  writeFileSync(join(root, 'packages/public/CHANGELOG.md'), `# @fixture/public\n\n## ${version}\n`)
  writeFileSync(join(root, 'packages/tree-sitter-cave/CHANGELOG.md'), `# @fixture/grammar\n\n## ${version}\n`)
  writeFileSync(join(root, 'editors/vscode/package.json'),
    `${JSON.stringify({ name: 'cave-language', version, private: true }, null, 2)}\n`)
}

const writeReleaseConfig = (root: string, fixed: string[]): void => {
  mkdirSync(join(root, '.changeset'), { recursive: true })
  writeFileSync(join(root, '.changeset/config.json'), `${JSON.stringify({
    changelog: '@changesets/cli/changelog',
    commit: false,
    fixed: [fixed],
    linked: [],
    access: 'public',
    baseBranch: 'main',
    updateInternalDependencies: 'patch',
    ignore: [],
    privatePackages: { version: true, tag: false }
  }, null, 2)}\n`)
}

const writeChangeset = (root: string, name: string, body: string): void => {
  writeFileSync(join(root, `.changeset/${name}.md`), body)
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
  writeReleaseConfig(root, ['@fixture/public', '@fixture/grammar'])
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'previous release')
  writeVersions(root, '1.2.3')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'version packages')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'push', '-u', 'origin', 'main')
  return { root, cleanup: () => rmSync(parent, { recursive: true, force: true }) }
}

const validate = (root: string, mode: 'version-pr' | 'publish' = 'publish') =>
  spawnSync(process.execPath, [validator, `--mode=${mode}`], {
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

test('version-PR preflight preserves a recovery path for a new package with version drift', async t => {
  await t.test('accepts repairable drift while changesets are pending', () => {
    const { root, cleanup } = fixture()
    try {
      mkdirSync(join(root, 'packages/new-package'), { recursive: true })
      writeFileSync(join(root, 'packages/new-package/package.json'), `${JSON.stringify({
        name: '@fixture/new-package',
        version: '0.1.0'
      }, null, 2)}\n`)
      writeReleaseConfig(root, ['@fixture/public', '@fixture/grammar', '@fixture/new-package'])
      writeChangeset(root, 'new-package', '---\n"@fixture/new-package": minor\n---\n\nRelease the new package.\n')
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'add new package')
      git(root, 'push', 'origin', 'main')

      const result = validate(root, 'version-pr')
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /version-PR preflight ok: 1 pending changeset/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects pending changesets with unknown package names', () => {
    const { root, cleanup } = fixture()
    try {
      writeChangeset(root, 'unknown', '---\n"@fixture/missing": patch\n---\n\nInvalid package.\n')
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'add invalid changeset')
      git(root, 'push', 'origin', 'main')

      const result = validate(root, 'version-pr')
      assert.equal(result.status, 1)
      assert.match(result.stderr, /names unknown package @fixture\/missing/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects public packages outside the fixed group', () => {
    const { root, cleanup } = fixture()
    try {
      writeReleaseConfig(root, ['@fixture/public'])
      writeChangeset(root, 'pending', '---\n"@fixture/public": patch\n---\n\nPending release.\n')
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'break fixed group')
      git(root, 'push', 'origin', 'main')

      const result = validate(root, 'version-pr')
      assert.equal(result.status, 1)
      assert.match(result.stderr, /fixed group must contain every public package exactly once/)
    } finally {
      cleanup()
    }
  })
})

test('release preflight accepts only an authoritative version commit and matching tag', async t => {
  await t.test('accepts the committed version-introducing main commit', () => {
    const { root, cleanup } = fixture()
    try {
      const result = validate(root)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /publish preflight ok: v1\.2\.3/)
    } finally {
      cleanup()
    }
  })

  await t.test('refreshes a stale origin/main tracking ref', () => {
    const { root, cleanup } = fixture()
    try {
      git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD^')
      const result = validate(root)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(git(root, 'rev-parse', 'refs/remotes/origin/main'), git(root, 'rev-parse', 'HEAD'))
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
      assert.match(result.stderr, /release inputs differ from their committed contents/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects extension version drift at a release commit', () => {
    const { root, cleanup } = fixture()
    try {
      const manifestPath = join(root, 'editors/vscode/package.json')
      writeFileSync(manifestPath,
        `${JSON.stringify({ name: 'cave-language', version: '1.2.2', private: true }, null, 2)}\n`)
      git(root, 'add', manifestPath)
      git(root, 'commit', '--amend', '--no-edit')
      git(root, 'push', '--force', 'origin', 'main')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /editors\/vscode\/package\.json is at committed version 1\.2\.2, expected 1\.2\.3/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects pending changesets before publish', () => {
    const { root, cleanup } = fixture()
    try {
      writeChangeset(root, 'pending', '---\n"@fixture/public": patch\n---\n\nPending release.\n')
      git(root, 'add', '.')
      git(root, 'commit', '--amend', '--no-edit')
      git(root, 'push', '--force', 'origin', 'main')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /version PR to consume 1 pending changeset/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects a missing package changelog entry', () => {
    const { root, cleanup } = fixture()
    try {
      writeFileSync(join(root, 'packages/public/CHANGELOG.md'), '# @fixture/public\n')
      git(root, 'add', '.')
      git(root, 'commit', '--amend', '--no-edit')
      git(root, 'push', '--force', 'origin', 'main')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /packages\/public\/CHANGELOG\.md has no release entry for 1\.2\.3/)
    } finally {
      cleanup()
    }
  })

  await t.test('rejects inconsistent workspace dependency ranges', () => {
    const { root, cleanup } = fixture()
    try {
      const manifestPath = join(root, 'packages/public/package.json')
      writeFileSync(manifestPath, `${JSON.stringify({
        name: '@fixture/public',
        version: '1.2.3',
        dependencies: { '@fixture/grammar': '^1.2.3' }
      }, null, 2)}\n`)
      git(root, 'add', '.')
      git(root, 'commit', '--amend', '--no-edit')
      git(root, 'push', '--force', 'origin', 'main')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /dependencies\.@fixture\/grammar is "\^1\.2\.3", expected "workspace:\*"/)
    } finally {
      cleanup()
    }
  })
})
