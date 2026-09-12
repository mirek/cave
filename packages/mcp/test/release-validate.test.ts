import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const validator = fileURLToPath(new URL('../../../scripts/release-validate.mjs', import.meta.url))
const publisher = fileURLToPath(new URL('../../../scripts/release-publish.sh', import.meta.url))
const synchronizer = fileURLToPath(new URL('../../../scripts/sync-versions.mjs', import.meta.url))

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
  writeFileSync(join(root, 'editors/vscode/CHANGELOG.md'), `# cave-language\n\n## ${version}\n`)
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

const fixture = (prepare: (root: string) => void = () => {}): { root: string, cleanup: () => void } => {
  const parent = mkdtempSync(join(tmpdir(), 'cave-release-'))
  const root = join(parent, 'repo')
  const remote = join(parent, 'origin.git')
  mkdirSync(root)
  git(root, 'init', '--initial-branch=main')
  git(root, 'config', 'user.name', 'Release Test')
  git(root, 'config', 'user.email', 'release@example.test')
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts/release-publish.sh'), readFileSync(publisher))
  writeFileSync(join(root, 'scripts/release-output.mjs'), readFileSync(new URL('../../../scripts/release-output.mjs', import.meta.url)))
  writeFileSync(join(root, 'scripts/release-validate.mjs'), readFileSync(validator))
  writeFileSync(join(root, 'scripts/changeset-metadata.mjs'), readFileSync(new URL('../../../scripts/changeset-metadata.mjs', import.meta.url)))
  writeFileSync(join(root, 'scripts/smoke.sh'), 'exit 0\n')
  writeVersions(root, '1.2.2')
  writeFileSync(join(root, 'packages/public/index.js'), 'export const value = 1\n')
  writeFileSync(join(root, '.gitignore'), 'dist/\n')
  writeReleaseConfig(root, ['@fixture/public', '@fixture/grammar'])
  prepare(root)
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'previous release')
  writeVersions(root, '1.2.3')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'version packages')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'push', '-u', 'origin', 'main')
  return { root, cleanup: () => rmSync(parent, { recursive: true, force: true }) }
}

const validate = (root: string, mode: 'version-pr' | 'publish' = 'publish', env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [validator, `--mode=${mode}`], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CAVE_RELEASE_ROOT: root,
      GITHUB_ACTIONS: '',
      GITHUB_REF: '',
      GITHUB_SHA: '',
      CAVE_RELEASE_TAG: '',
      ...env
    }
  })

test('publisher rejects unsupported arguments before running preflight', () => {
  const root = mkdtempSync(join(tmpdir(), 'cave-publisher-arguments-'))
  try {
    const scripts = join(root, 'scripts')
    mkdirSync(scripts)
    const entrypoint = join(scripts, 'release-publish.sh')
    writeFileSync(entrypoint, readFileSync(publisher))
    writeFileSync(join(scripts, 'release-validate.mjs'),
      "import {writeFileSync} from 'node:fs'; writeFileSync('preflight-ran', 'unexpected'); process.exit(23);\n")
    for (const args of [['--dry-run'], ['--help'], ['extra'], ['--mode=version-pr']]) {
      const result = spawnSync('bash', [entrypoint, ...args], { cwd: root, encoding: 'utf8' })
      assert.equal(result.status, 2, result.stderr)
      assert.match(result.stderr, /usage: release-publish\.sh/)
      assert.equal(existsSync(join(root, 'preflight-ran')), false)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('release validation rejects unknown and ambiguous arguments before repository access', () => {
  const root = mkdtempSync(join(tmpdir(), 'cave-release-arguments-'))
  try {
    for (const args of [[], ['--mode=unknown'], ['--mode', 'publish'],
      ['--mode=publish', '--unexpected'], ['--mode=version-pr', 'extra'],
      ['--mode=publish', '--mode=version-pr'], ['--mode=version-pr', '--mode=publish'],
      ['--mode=publish', '--mode=publish']]) {
      const result = spawnSync(process.execPath, [validator, ...args], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, CAVE_RELEASE_ROOT: root, CAVE_RELEASE_TAG: '' }
      })
      assert.equal(result.status, 1, JSON.stringify(args))
      assert.match(result.stderr, /usage: release-validate\.mjs --mode=version-pr\|publish/, JSON.stringify(args))
      assert.doesNotMatch(result.stderr, /git .*failed|not a git repository/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('installed Changesets versions the real workspace before derived version synchronization', () => {
  const repository = fileURLToPath(new URL('../../..', import.meta.url))
  const root = mkdtempSync(join(tmpdir(), 'cave-changesets-workspace-'))
  const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
  try {
    const directories = ['website', ...['packages', 'editors'].flatMap(parent =>
      readdirSync(join(repository, parent), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && existsSync(join(repository, parent, entry.name, 'package.json')))
        .map(entry => `${parent}/${entry.name}`))]
    for (const path of ['package.json', 'pnpm-workspace.yaml', '.changeset/config.json',
      'packages/tree-sitter-cave/tree-sitter.json',
      ...directories.flatMap(directory => [`${directory}/package.json`, `${directory}/CHANGELOG.md`])]) {
      if (!existsSync(join(repository, path))) continue
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), readFileSync(join(repository, path)))
    }
    // The fixture uses installed tooling without installing or modifying the checkout.
    symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'junction')
    const previous = read('package.json').version
    const website = read('website/package.json').version
    writeChangeset(root, 'fixture', '---\n"@cavelang/core": patch\n"@cavelang/cli": patch\n"@cavelang/act": patch\n---\n\nFixture release.\n')
    const cli = createRequire(import.meta.url).resolve('@changesets/cli/bin.js')
    const run = () => spawnSync(process.execPath, [cli, 'version'], { cwd: root, encoding: 'utf8' })
    const result = run()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const version = read('packages/core/package.json').version
    assert.notEqual(version, previous)
    for (const name of read('.changeset/config.json').fixed.flat()) {
      const directory = directories.find(directory => read(`${directory}/package.json`).name === name)!
      assert.equal(read(`${directory}/package.json`).version, version, name)
    }
    assert.notEqual(read('packages/act/package.json').version, previous)
    assert.equal(read('package.json').version, previous, 'Changesets does not version the workspace root')
    const synced = spawnSync(process.execPath, [synchronizer], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CAVE_RELEASE_ROOT: root }
    })
    assert.equal(synced.status, 0, synced.stderr)
    assert.equal(read('package.json').version, version)
    assert.equal(read('packages/tree-sitter-cave/tree-sitter.json').metadata.version, version)
    assert.equal(read('website/package.json').version, website)
    for (const directory of directories.filter(directory => directory !== 'website')) {
      assert.equal(read(`${directory}/package.json`).version, version, directory)
      assert.ok(readFileSync(join(root, directory, 'CHANGELOG.md'), 'utf8').split('\n').includes(`## ${version}`),
        `${directory} needs the changelog entry read by the version-PR action`)
    }
    const second = run()
    assert.equal(second.status, 1, second.stdout + second.stderr)
    assert.match(second.stdout + second.stderr, /No unreleased changesets found/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('version synchronization attributes provisional private notes to the lockstep release', () => {
  for (const [previous, provisional, next] of [
    ['0.35.0', '0.35.1', '0.36.0'],
    ['1.9.0', '1.10.0', '2.0.0']
  ] as const) {
    const root = mkdtempSync(join(tmpdir(), 'cave-private-notes-'))
    try {
      writeVersions(root, previous)
      mkdirSync(join(root, 'packages/core'))
      mkdirSync(join(root, 'packages/private'))
      writeFileSync(join(root, 'packages/core/package.json'), JSON.stringify({ name: '@cavelang/core', version: next }))
      writeFileSync(join(root, 'packages/private/package.json'), JSON.stringify({ name: '@fixture/private', private: true, version: provisional }))
      const history = `## ${previous}\n\n### Patch Changes\n\n- Historical fix.\n`
      const notes = '\n\n### Patch Changes\n\n- Actual private fix.\n\n'
      const path = join(root, 'packages/private/CHANGELOG.md')
      writeFileSync(path, `# @fixture/private\n\n## ${provisional}${notes}${history}`)
      const run = () => spawnSync(process.execPath, [synchronizer], {
        encoding: 'utf8', env: { ...process.env, CAVE_RELEASE_ROOT: root }
      })
      const first = run()
      assert.equal(first.status, 0, first.stderr)
      const expected = `# @fixture/private\n\n## ${next}${notes}${history}`
      assert.equal(readFileSync(path, 'utf8'), expected)
      assert.equal(JSON.parse(readFileSync(join(root, 'packages/private/package.json'), 'utf8')).version, next)
      const second = run()
      assert.equal(second.status, 0, second.stderr)
      assert.equal(readFileSync(path, 'utf8'), expected, 'retry preserves notes and history exactly')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('version synchronization gives the private VS Code workspace a changelog entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'cave-version-sync-'))
  try {
    mkdirSync(join(root, 'packages/core'), { recursive: true })
    mkdirSync(join(root, 'packages/private'), { recursive: true })
    mkdirSync(join(root, 'packages/tree-sitter-cave'), { recursive: true })
    mkdirSync(join(root, 'editors/vscode'), { recursive: true })
    writeFileSync(join(root, 'packages/core/package.json'), '{"name":"@fixture/core","version":"2.0.0"}\n')
    writeFileSync(join(root, 'packages/private/package.json'),
      '{"name":"@fixture/private","version":"1.9.0","private":true}\n')
    writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"1.9.0","private":true}\n')
    writeFileSync(join(root, 'editors/vscode/package.json'),
      '{"name":"cave-language","version":"1.9.0","private":true}\n')
    writeFileSync(join(root, 'editors/vscode/CHANGELOG.md'), '# cave-language\n\n## 1.9.0\n\nPrevious release.\n')
    writeFileSync(join(root, 'packages/tree-sitter-cave/tree-sitter.json'),
      '{"metadata":{"version":"1.9.0"}}\n')

    const first = spawnSync(process.execPath, [synchronizer], {
      encoding: 'utf8',
      env: { ...process.env, CAVE_RELEASE_ROOT: root }
    })
    assert.equal(first.status, 0, first.stderr)
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '2.0.0')
    assert.equal(JSON.parse(readFileSync(join(root, 'packages/private/package.json'), 'utf8')).version, '2.0.0')
    assert.equal(JSON.parse(readFileSync(join(root, 'editors/vscode/package.json'), 'utf8')).version, '2.0.0')
    assert.equal(JSON.parse(readFileSync(join(root, 'packages/tree-sitter-cave/tree-sitter.json'), 'utf8'))
      .metadata.version, '2.0.0')
    const changelog = readFileSync(join(root, 'editors/vscode/CHANGELOG.md'), 'utf8')
    assert.match(changelog, /^# cave-language\n\n## 2\.0\.0\n\n### Major Changes/m)
    assert.ok(changelog.indexOf('## 2.0.0') < changelog.indexOf('## 1.9.0'))

    const second = spawnSync(process.execPath, [synchronizer], {
      encoding: 'utf8',
      env: { ...process.env, CAVE_RELEASE_ROOT: root }
    })
    assert.equal(second.status, 0, second.stderr)
    assert.equal([...readFileSync(join(root, 'editors/vscode/CHANGELOG.md'), 'utf8')
      .matchAll(/^## 2\.0\.0$/gm)].length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('failed alignment changelog writes can be retried without losing release entries', () => {
  for (const directory of ['packages/private', 'editors/vscode']) {
    const root = mkdtempSync(join(tmpdir(), 'cave-version-retry-'))
    try {
      for (const path of ['packages/core', 'packages/private', 'packages/tree-sitter-cave', 'editors/vscode']) {
        mkdirSync(join(root, path), { recursive: true })
      }
      writeFileSync(join(root, 'packages/core/package.json'), '{"name":"@fixture/core","version":"2.0.0"}')
      writeFileSync(join(root, 'packages/private/package.json'), '{"name":"@fixture/private","version":"1.9.0","private":true}')
      writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"1.9.0","private":true}')
      writeFileSync(join(root, 'editors/vscode/package.json'), '{"name":"cave-language","version":"1.9.0","private":true}')
      writeFileSync(join(root, 'packages/tree-sitter-cave/tree-sitter.json'), '{"metadata":{"version":"1.9.0"}}')
      const changelogPath = join(root, directory, 'CHANGELOG.md')
      // A directory at the file path fails consistently, even with elevated permissions.
      mkdirSync(changelogPath)
      const run = () => spawnSync(process.execPath, [synchronizer], {
        encoding: 'utf8', env: { ...process.env, CAVE_RELEASE_ROOT: root }
      })
      const failed = run()
      assert.notEqual(failed.status, 0, directory)
      assert.equal(JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')).version,
        '1.9.0', `${directory}: preserve the old version until its changelog succeeds`)
      rmSync(changelogPath, { recursive: true })
      writeFileSync(changelogPath, '# Fixture history\n\n## 1.9.0\n\nPrevious release.\n')
      const recovered = run()
      assert.equal(recovered.status, 0, recovered.stderr)
      assert.equal(JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')).version, '2.0.0')
      const changelog = readFileSync(changelogPath, 'utf8')
      assert.match(changelog, /^# Fixture history\n\n## 2\.0\.0\n\n### Major Changes/m)
      assert.ok(changelog.endsWith('## 1.9.0\n\nPrevious release.\n'))
      assert.equal(run().status, 0)
      assert.equal(readFileSync(changelogPath, 'utf8'), changelog, 'retry must not duplicate the release entry')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('bundled private changes require matching or higher CLI release severity', () => {
  for (const cliSeverity of [undefined, 'patch', 'minor', 'major']) {
    const { root, cleanup } = fixture()
    try {
      mkdirSync(join(root, 'packages/cli'))
      mkdirSync(join(root, 'packages/sync'))
      writeFileSync(join(root, 'packages/cli/package.json'), JSON.stringify({
        name: '@cavelang/cli', version: '1.2.3',
        publishConfig: { exports: { './sync': { default: './dist/internal/sync/index.js' } } }
      }))
      writeFileSync(join(root, 'packages/sync/package.json'), JSON.stringify({
        name: '@cavelang/sync', version: '1.2.3', private: true
      }))
      writeReleaseConfig(root, ['@fixture/public', '@fixture/grammar', '@cavelang/cli'])
      writeChangeset(root, 'bundled', `---\n"@fixture/public": patch\n"@cavelang/sync": minor\n${cliSeverity === undefined ? '' : `"@cavelang/cli": ${cliSeverity}\n`}---\n\nChange bundled sync semantics.\n`)
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'change bundled module')
      git(root, 'push', 'origin', 'main')
      const result = validate(root, 'version-pr')
      if (cliSeverity === undefined || cliSeverity === 'patch') {
        assert.equal(result.status, 1, result.stdout)
        assert.match(result.stderr, /@cavelang\/sync.*minor.*@cavelang\/cli/)
      } else {
        assert.equal(result.status, 0, result.stderr)
      }
    } finally { cleanup() }
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
      writeChangeset(root, 'new-package', "---\n'@fixture/new-package': minor\n---\n\nRelease the new package.\n")
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

  await t.test('rejects changesets that name only packages outside the fixed group', () => {
    const { root, cleanup } = fixture()
    try {
      mkdirSync(join(root, 'packages/internal'), { recursive: true })
      writeFileSync(join(root, 'packages/internal/package.json'), `${JSON.stringify({
        name: '@fixture/internal',
        version: '1.2.3',
        private: true
      }, null, 2)}\n`)
      writeChangeset(root, 'internal-only', "---\n'@fixture/internal': patch\n---\n\nInternal-only change.\n")
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'add private-only changeset')
      git(root, 'push', 'origin', 'main')

      const result = validate(root, 'version-pr')
      assert.equal(result.status, 1)
      assert.match(result.stderr, /names only packages outside the fixed release group \(@fixture\/internal\)/)
    } finally {
      cleanup()
    }
  })

  await t.test('counts every committed changeset path without Git display quoting', () => {
    const { root, cleanup } = fixture()
    try {
      const names = ['space name', 'quote"name', 'glob[one]', 'line\nbreak', 'café']
      for (const name of names) writeChangeset(root, name, '---\n"@fixture/public": patch\n---\n\nPending.\n')
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'add unusual changeset paths')
      git(root, 'push', 'origin', 'main')
      const version = validate(root, 'version-pr')
      assert.equal(version.status, 0, version.stderr)
      assert.match(version.stdout, /5 pending changeset/)
      const publish = validate(root, 'publish')
      assert.equal(publish.status, 1)
      assert.match(publish.stderr, /version PR to consume 5 pending changeset/)
    } finally { cleanup() }
  })

  await t.test('validates committed changeset text without trimming its frontmatter', () => {
    const { root, cleanup } = fixture()
    try {
      writeChangeset(root, 'leading-blank', '\n---\n"@fixture/public": patch\n---\n\nPending.\n')
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'add malformed frontmatter')
      git(root, 'push', 'origin', 'main')
      const result = validate(root, 'version-pr')
      assert.equal(result.status, 1)
      assert.match(result.stderr, /must contain YAML frontmatter/)
    } finally { cleanup() }
  })

  await t.test('blocks publication when every pending filename requires Git quoting', () => {
    const { root, cleanup } = fixture(root => {
      for (const name of ['café', 'line\nbreak']) {
        writeChangeset(root, name, '---\n"@fixture/public": patch\n---\n\nPending.\n')
      }
    })
    try {
      const result = validate(root, 'publish')
      assert.equal(result.status, 1)
      assert.match(result.stderr, /version PR to consume 2 pending changeset/)
    } finally { cleanup() }
  })

  await t.test('accepts documentation-only changesets with empty frontmatter', () => {
    const { root, cleanup } = fixture()
    try {
      writeChangeset(root, 'documentation', '---\n---\n\nDocument the release.\n')
      git(root, 'add', '.')
      git(root, 'commit', '-m', 'document release')
      git(root, 'push', 'origin', 'main')

      const result = validate(root, 'version-pr')
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /version-PR preflight ok: 1 pending changeset/)
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

  await t.test('rejects a missing VS Code changelog entry', () => {
    const { root, cleanup } = fixture()
    try {
      writeFileSync(join(root, 'editors/vscode/CHANGELOG.md'), '# cave-language\n')
      git(root, 'add', '.')
      git(root, 'commit', '--amend', '--no-edit')
      git(root, 'push', '--force', 'origin', 'main')
      const result = validate(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /editors\/vscode\/CHANGELOG\.md has no release entry for 1\.2\.3/)
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

test('publish preflight rejects uncommitted package content', async t => {
  for (const change of ['unstaged', 'staged', 'deleted', 'untracked'] as const) {
    await t.test(change, () => {
      const { root, cleanup } = fixture()
      try {
        const source = join(root, 'packages/public/index.js')
        if (change === 'deleted') rmSync(source)
        else if (change === 'untracked') writeFileSync(join(root, 'packages/public/extra.js'), 'export const extra = true\n')
        else writeFileSync(source, 'export const value = 2\n')
        if (change === 'staged') git(root, 'add', 'packages/public/index.js')
        const result = validate(root)
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /publish requires a clean tracked and untracked worktree/)
      } finally { cleanup() }
    })
  }
  await t.test('ignored build outputs remain permitted', () => {
    const { root, cleanup } = fixture()
    try {
      mkdirSync(join(root, 'packages/public/dist'))
      writeFileSync(join(root, 'packages/public/dist/index.js'), 'generated output\n')
      const result = validate(root)
      assert.equal(result.status, 0, result.stderr)
    } finally { cleanup() }
  })
})

test('manual Marketplace preflight verifies the selected release tag instead of the workflow commit', () => {
  const { root, cleanup } = fixture()
  try {
    const release = git(root, 'rev-parse', 'HEAD')
    git(root, 'tag', 'v1.2.3')
    writeFileSync(join(root, 'README.md'), 'later workflow commit\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'later development')
    const workflow = git(root, 'rev-parse', 'HEAD')
    git(root, 'push', 'origin', 'main', '--tags')
    git(root, 'checkout', '--detach', release)
    const env = {
      GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: workflow,
      GITHUB_EVENT_NAME: 'workflow_dispatch', CAVE_RELEASE_TAG: 'v1.2.3'
    }
    const result = validate(root, 'publish', env)
    assert.equal(result.status, 0, result.stderr)
    const wrong = validate(root, 'publish', { ...env, CAVE_RELEASE_TAG: 'v1.2.2' })
    assert.notEqual(wrong.status, 0)
    assert.match(wrong.stderr, /selected release tag/)
    const ordinary = validate(root, 'publish', { ...env, CAVE_RELEASE_TAG: '' })
    assert.notEqual(ordinary.status, 0)
    assert.match(ordinary.stderr, /GITHUB_SHA .* does not match checkout/)
    const push = validate(root, 'publish', { ...env, GITHUB_EVENT_NAME: 'push' })
    assert.notEqual(push.status, 0)
    assert.match(push.stderr, /selected release tag requires a manual publish workflow/)
  } finally { cleanup() }
})

test('the publish entrypoint cannot validate a different checkout through inherited environment', () => {
  const target = fixture()
  const unrelated = fixture()
  const controls = mkdtempSync(join(tmpdir(), 'cave-publish-controls-'))
  const startup = join(controls, 'startup.sh')
  const probes = join(controls, 'probes')
  writeFileSync(probes, '')
  writeFileSync(startup, [
    'npm() { printf "probe\\n" >> "$CAVE_TEST_PROBES"; printf "1.2.3\\n"; }',
    'pnpm() { return 0; }'
  ].join('\n'))
  try {
    writeFileSync(join(target.root, 'packages/public/index.js'), 'uncommitted package bytes\n')
    const result = spawnSync('bash', [join(target.root, 'scripts/release-publish.sh')], {
      cwd: target.root,
      encoding: 'utf8',
      env: { ...process.env, CAVE_RELEASE_ROOT: unrelated.root, CAVE_RELEASE_TAG: '',
        GITHUB_ACTIONS: '', GITHUB_REF: '', GITHUB_SHA: '',
        BASH_ENV: startup.replaceAll('\\', '/'), CAVE_TEST_PROBES: probes.replaceAll('\\', '/') }
    })
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /publish requires a clean tracked and untracked worktree/)
    assert.equal(readFileSync(probes, 'utf8'), '', 'registry probing must not begin for the dirty target checkout')
    writeFileSync(join(target.root, 'packages/public/index.js'), 'export const value = 1\n')
    writeFileSync(startup, [
      'npm() { printf "probe\\n" >> "$CAVE_TEST_PROBES"; printf "1.2.3\\n"; }',
      'pnpm() { printf "changed during build\\n" > "$CAVE_TEST_SOURCE"; }'
    ].join('\n'))
    const drift = spawnSync('bash', [join(target.root, 'scripts/release-publish.sh')], {
      cwd: target.root,
      encoding: 'utf8',
      env: { ...process.env, CAVE_RELEASE_ROOT: unrelated.root, CAVE_RELEASE_TAG: '',
        GITHUB_ACTIONS: '', GITHUB_REF: '', GITHUB_SHA: '',
        BASH_ENV: startup.replaceAll('\\', '/'), CAVE_TEST_PROBES: probes.replaceAll('\\', '/'),
        CAVE_TEST_SOURCE: join(target.root, 'packages/public/index.js').replaceAll('\\', '/') }
    })
    assert.notEqual(drift.status, 0, drift.stdout)
    assert.match(drift.stderr, /publish requires a clean tracked and untracked worktree/)
    assert.ok(readFileSync(probes, 'utf8').length > 0, 'initial validation succeeded before build drift')
    assert.notEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/tags/v1.2.3'],
      { cwd: target.root }).status, 0, 'the dirty target must not receive a recovery tag')

  } finally {
    target.cleanup()
    unrelated.cleanup()
    rmSync(controls, { recursive: true, force: true })
  }
})

test('release preparation rebuilds altered outputs and removes obsolete emitted files', () => {
  const tsc = createRequire(import.meta.url).resolve('typescript/lib/tsc.js')
  const cleaner = fileURLToPath(new URL('../../../scripts/clean.mjs', import.meta.url))
  const target = fixture(root => {
    writeFileSync(join(root, 'scripts/clean.mjs'), readFileSync(cleaner))
    writeFileSync(join(root, '.gitignore'), 'dist/\n*.tsbuildinfo\n')
    mkdirSync(join(root, 'packages/public/src'))
    writeFileSync(join(root, 'packages/public/src/index.ts'), 'export const value = 1\n')
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { composite: true, target: 'ES2022', module: 'ES2022', types: [],
        rootDir: 'packages/public/src', outDir: 'packages/public/dist' },
      include: ['packages/public/src/index.ts']
    }))
  })
  const controls = mkdtempSync(join(tmpdir(), 'cave-release-outputs-'))
  const startup = join(controls, 'startup.sh')
  writeFileSync(startup, [
    'npm() { printf "1.2.3\\n"; }',
    'pnpm() {',
    '  case "$*" in',
    '    clean) "$CAVE_TEST_NODE" scripts/clean.mjs ;;',
    '    build) "$CAVE_TEST_NODE" "$CAVE_TEST_TSC" -b ;;',
    '    *) return 0 ;;',
    '  esac',
    '}'
  ].join('\n'))
  try {
    execFileSync(process.execPath, [tsc, '-b'], { cwd: target.root, stdio: 'pipe' })
    const output = join(target.root, 'packages/public/dist/index.js')
    const obsolete = join(target.root, 'packages/public/dist/obsolete.js')
    writeFileSync(output, 'export const value = 999;\n')
    writeFileSync(obsolete, 'obsolete emitted code\n')
    assert.equal(git(target.root, 'status', '--porcelain'), '', 'both altered outputs are ignored')
    const result = spawnSync('bash', [join(target.root, 'scripts/release-publish.sh')], {
      cwd: target.root, encoding: 'utf8',
      env: { ...process.env, CAVE_RELEASE_TAG: '', GITHUB_ACTIONS: '', GITHUB_REF: '', GITHUB_SHA: '',
        BASH_ENV: startup.replaceAll('\\', '/'), CAVE_TEST_NODE: process.execPath.replaceAll('\\', '/'),
        CAVE_TEST_TSC: tsc.replaceAll('\\', '/') }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(readFileSync(output, 'utf8'), /value = 1;/)
    assert.equal(existsSync(obsolete), false, 'obsolete output cannot survive release preparation')
  } finally {
    target.cleanup()
    rmSync(controls, { recursive: true, force: true })
  }
})

test('a superseded release cannot publish missing versions under latest', () => {
  const target = fixture()
  const controls = mkdtempSync(join(tmpdir(), 'cave-release-superseded-'))
  const startup = join(controls, 'startup.sh')
  const published = join(controls, 'published')
  writeFileSync(startup, [
    'npm() {',
    '  if [ "$2" = "@fixture/public@1.2.3" ] && [ ! -f "$CAVE_TEST_PUBLISHED" ]; then',
    '    echo "npm error code E404" >&2; return 1',
    '  fi',
    '  if [ "$3" = "name" ]; then printf "%s" "$2"; else printf "1.2.3"; fi',
    '}',
    'pnpm() {',
    '  if [ "$1" = "-r" ] && [ "$2" = "publish" ]; then printf "published" > "$CAVE_TEST_PUBLISHED"; fi',
    '  return 0',
    '}'
  ].join('\n'))
  try {
    const release = git(target.root, 'rev-parse', 'HEAD')
    writeVersions(target.root, '1.2.4')
    git(target.root, 'add', '.')
    git(target.root, 'commit', '-m', 'newer release')
    git(target.root, 'push', 'origin', 'main')
    git(target.root, 'checkout', '--detach', release)
    const result = spawnSync('bash', [join(target.root, 'scripts/release-publish.sh')], {
      cwd: target.root, encoding: 'utf8',
      env: { ...process.env, CAVE_RELEASE_TAG: '', GITHUB_ACTIONS: '', GITHUB_REF: '', GITHUB_SHA: '',
        BASH_ENV: startup.replaceAll('\\', '/'), CAVE_TEST_PUBLISHED: published.replaceAll('\\', '/') }
    })
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /superseded by origin\/main version 1.2.4/)
    assert.equal(existsSync(published), false, 'no publication is attempted for the superseded version')
    writeFileSync(published, 'already on the registry')
    const recovered = spawnSync('bash', [join(target.root, 'scripts/release-publish.sh')], {
      cwd: target.root, encoding: 'utf8',
      env: { ...process.env, CAVE_RELEASE_TAG: '', GITHUB_ACTIONS: '', GITHUB_REF: '', GITHUB_SHA: '',
        BASH_ENV: startup.replaceAll('\\', '/'), CAVE_TEST_PUBLISHED: published.replaceAll('\\', '/') }
    })
    assert.equal(recovered.status, 0, recovered.stderr)
    assert.equal(git(target.root, 'rev-parse', 'refs/tags/v1.2.3'), release)
    assert.equal(readFileSync(published, 'utf8'), 'already on the registry', 'tag recovery does not republish')

  } finally {
    target.cleanup()
    rmSync(controls, { recursive: true, force: true })
  }
})

test('publication events follow verified publication and tag recovery', () => {
  for (const mode of ['publish', 'partial', 'recovery', 'verification-failure', 'publish-failure', 'tag-failure'] as const) {
    const target = fixture()
    const controls = mkdtempSync(join(tmpdir(), 'cave-release-output-'))
    const startup = join(controls, 'startup.sh')
    const output = join(controls, 'changesets output.jsonl')
    const published = join(controls, 'published')
    writeFileSync(startup, [
      'npm() {',
      '  if [ "$3" = name ]; then printf "%s" "$2"; return 0; fi',
      '  if [ "$CAVE_TEST_MODE" = recovery ] || { [ "$CAVE_TEST_MODE" = partial ] && [ "$2" = "@fixture/grammar@1.2.3" ]; }; then printf "1.2.3"; return 0; fi',
      '  if [ -f "$CAVE_TEST_PUBLISHED" ] && [ "$CAVE_TEST_MODE" != verification-failure ]; then printf "1.2.3"; return 0; fi',
      '  echo "npm error code E404" >&2; return 1',
      '}',
      'pnpm() {',
      '  if [ "$1" = -r ] && [ "$2" = publish ]; then printf "published" > "$CAVE_TEST_PUBLISHED"; [ "$CAVE_TEST_MODE" != publish-failure ] || return 1; fi',
      '  return 0',
      '}',
      'git() {',
      '  if [ "$CAVE_TEST_MODE" = tag-failure ] && [ "$1" = push ] && [ "${3:-}" = v1.2.3 ]; then echo "tag push failed" >&2; return 1; fi',
      '  command git "$@"',
      '}'
    ].join('\n'))
    try {
      const result = spawnSync('bash', [join(target.root, 'scripts/release-publish.sh')], {
        cwd: target.root, encoding: 'utf8',
        env: { ...process.env, CAVE_RELEASE_TAG: '', GITHUB_ACTIONS: '', GITHUB_REF: '', GITHUB_SHA: '',
          BASH_ENV: startup.replaceAll('\\', '/'), CHANGESETS_OUTPUT: output,
          CAVE_TEST_MODE: mode, CAVE_TEST_PUBLISHED: published.replaceAll('\\', '/'),
          CAVE_NPM_VIEW_ATTEMPTS: '1', CAVE_NPM_VISIBILITY_ATTEMPTS: '1',
          CAVE_NPM_VIEW_RETRY_DELAY_SECONDS: '0', CAVE_NPM_VISIBILITY_RETRY_DELAY_SECONDS: '0' }
      })
      if (mode === 'verification-failure' || mode === 'publish-failure' || mode === 'tag-failure') {
        assert.notEqual(result.status, 0)
        if (mode === 'verification-failure') assert.match(result.stderr, /still not on the registry/)
        if (mode === 'tag-failure') assert.match(result.stderr, /tag push failed/)
        assert.equal(existsSync(output), false)
        assert.equal(git(target.root, 'ls-remote', '--tags', 'origin'), '')
      } else {
        assert.equal(result.status, 0, result.stderr)
        const text = readFileSync(output, 'utf8')
        const events = text === '' ? [] : text.trimEnd().split('\n').map(line => JSON.parse(line))
        const names = mode === 'recovery' ? [] : mode === 'partial' ? ['@fixture/public'] : ['@fixture/public', '@fixture/grammar']
        assert.deepEqual(events, names.map(packageName => ({ type: 'git-tag', tag: 'v1.2.3', packageName })))
        assert.equal(git(target.root, 'tag', '--list'), 'v1.2.3')
        assert.equal(existsSync(published), mode !== 'recovery')
      }
    } finally { target.cleanup(); rmSync(controls, { recursive: true, force: true }) }
  }
})
