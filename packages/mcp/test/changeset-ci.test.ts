import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('changeset CI treats branch names and added filenames as data', () => {
  const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const step = ci.slice(ci.indexOf('      - name: Require a changeset'), ci.indexOf('\n  suite:'))
  assert.ok(step.includes('BASE_REF: ${{ github.base_ref }}'))
  const script = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length)
    .split('\n').map(line => line.slice(10)).join('\n')
  for (const base of ['main', 'main$(touch${IFS}ref-evaluated)']) {
    const dir = mkdtempSync(join(tmpdir(), 'cave-changeset-ci-'))
    try {
      const git = (...args: string[]) => {
        const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
      }
      git('init', '-b', 'main')
      mkdirSync(join(dir, '.changeset'))
      mkdirSync(join(dir, 'scripts'))
      for (const name of ['check-changesets.mjs', 'changeset-metadata.mjs']) {
        writeFileSync(join(dir, 'scripts', name), readFileSync(new URL(`../../../scripts/${name}`, import.meta.url)))
      }
      for (const name of ['core', 'mcp', 'cli', 'sync']) {
        mkdirSync(join(dir, 'packages', name), { recursive: true })
        writeFileSync(join(dir, 'packages', name, 'package.json'), JSON.stringify({
          name: `@cavelang/${name}`, private: name === 'mcp' || name === 'sync',
          ...(name === 'cli' ? { publishConfig: { exports: { './sync': './dist/internal/sync/index.js' } } } : {})
        }))
      }
      writeFileSync(join(dir, '.changeset/config.json'), JSON.stringify({ fixed: [['@cavelang/core', '@cavelang/cli']] }))
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'base')
      git('update-ref', `refs/remotes/origin/${base}`, 'HEAD')
      for (const name of ['space name.md', 'quote"name.md', 'glob[one].md', 'line\nbreak.md', 'café.md']) {
        writeFileSync(join(dir, '.changeset', name), '---\n"@cavelang/core": patch\n---\n\nFixture.\n')
      }
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'changesets')
      // Render the former inline expression too, so this regression reproduces
      // the actual shell behavior of the old workflow before it is fixed.
      const rendered = script.replaceAll('${{ github.base_ref }}', base)
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', rendered], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: base }
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(existsSync(join(dir, 'ref-evaluated')), false)
      writeFileSync(join(dir, '.changeset/space name.md'), '---\n"@cavelang/mcp": patch\n---\n\nPrivate-only fixture.\n')
      const privateOnly = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: base }
      })
      assert.notEqual(privateOnly.status, 0)
      assert.match(privateOnly.stdout + privateOnly.stderr, /names only packages outside the fixed release group/)
      for (const body of [
        'not frontmatter',
        '---\n"@cavelang/core": patch\n---\n',
        '---\n"@cavelang/core": invalid\n---\nSummary.',
        '---\n"@cavelang/core": patch\n"@cavelang/core": minor\n---\nSummary.',
        '---\n"@cavelang/core": patch\n"@cavelang/missing": patch\n---\nSummary.',
        '---\n"@cavelang/core": patch\n"@cavelang/sync": minor\n---\nSummary.',
        '---\n"@cavelang/cli": patch\n"@cavelang/sync": minor\n---\nSummary.'
      ]) {
        writeFileSync(join(dir, '.changeset/space name.md'), body)
        const malformed = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
          cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: base }
        })
        assert.notEqual(malformed.status, 0, body)
      }
      for (const body of ['---\n---\nDocumentation only.', '---\n"@cavelang/cli": minor\n"@cavelang/sync": minor\n---\nSummary.']) {
        writeFileSync(join(dir, '.changeset/space name.md'), body)
        const valid = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
          cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: base }
        })
        assert.equal(valid.status, 0, valid.stderr)
      }
      const missing = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: 'missing' }
      })
      assert.notEqual(missing.status, 0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test('only the exact same-repository version PR bypasses new changeset validation', () => {
  const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(ci, /\n  changeset:\n    if: github.event_name == 'pull_request'\n/)
  const step = ci.slice(ci.indexOf('      - name: Require a changeset'), ci.indexOf('\n  suite:'))
  for (const binding of ['HEAD_REF: ${{ github.head_ref }}', 'HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}', 'REPOSITORY: ${{ github.repository }}']) {
    assert.ok(step.includes(binding))
  }
  const script = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length)
    .split('\n').map(line => line.slice(10)).join('\n')
  const dir = mkdtempSync(join(tmpdir(), 'cave-version-pr-'))
  try {
    for (const [head, source, base, exempt] of [
      ['changeset-release/main', 'mirek/cave', 'main', true],
      ['changeset-release/main', 'fork/cave', 'main', false],
      ['changeset-release/feature', 'mirek/cave', 'main', false],
      ['changeset-release/main-extra', 'mirek/cave', 'main', false],
      ['Changeset-release/main', 'mirek/cave', 'main', false],
      ['changeset-release/main', 'mirek/cave', 'other', false],
      ['feature', 'mirek/cave', 'main', false]
    ] as const) {
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: dir, encoding: 'utf8', env: {
        ...process.env, HEAD_REF: head, HEAD_REPOSITORY: source, BASE_REF: base, REPOSITORY: 'mirek/cave'
      } })
      assert.equal(result.error, undefined)
      assert.equal(result.status === 0, exempt, `${head}/${source}/${base}: ${result.stderr}`)
      if (exempt) assert.match(result.stdout, /Version PR consumes changesets/)
      else assert.match(result.stderr, /Could not compare changesets/)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('changeset checker rejects missing, duplicate, private and unknown fixed-group members', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-changeset-group-'))
  try {
    mkdirSync(join(dir, '.changeset'))
    mkdirSync(join(dir, 'scripts'))
    for (const name of ['check-changesets.mjs', 'changeset-metadata.mjs']) {
      writeFileSync(join(dir, 'scripts', name), readFileSync(new URL(`../../../scripts/${name}`, import.meta.url)))
    }
    for (const name of ['core', 'cli', 'mcp']) {
      mkdirSync(join(dir, 'packages', name), { recursive: true })
      writeFileSync(join(dir, 'packages', name, 'package.json'), JSON.stringify({ name: `@cavelang/${name}`, private: name === 'mcp' }))
    }
    const changeset = '---\n"@cavelang/core": patch\n---\n\nValid release entry.\n'
    writeFileSync(join(dir, '.changeset/valid.md'), changeset)
    const check = () => spawnSync(process.execPath, ['scripts/check-changesets.mjs', '.changeset/valid.md'], { cwd: dir, encoding: 'utf8' })
    for (const members of [
      ['@cavelang/core'],
      ['@cavelang/core', '@cavelang/cli', '@cavelang/core'],
      ['@cavelang/core', '@cavelang/cli', '@cavelang/mcp'],
      ['@cavelang/core', '@cavelang/cli', '@cavelang/missing'],
      ['@cavelang/core', '@cavelang/mcp'],
      ['@cavelang/core', 42]
    ]) {
      const config = JSON.stringify({ fixed: [members] })
      writeFileSync(join(dir, '.changeset/config.json'), config)
      const result = check()
      assert.equal(result.error, undefined)
      assert.equal(result.status, 1, JSON.stringify(members))
      assert.match(result.stderr, /fixed group must contain every public package exactly once/)
      assert.equal(readFileSync(join(dir, '.changeset/config.json'), 'utf8'), config)
      assert.equal(readFileSync(join(dir, '.changeset/valid.md'), 'utf8'), changeset)
    }
    writeFileSync(join(dir, '.changeset/config.json'), JSON.stringify({ fixed: [['@cavelang/cli', '@cavelang/core']] }))
    const repaired = check()
    assert.equal(repaired.status, 0, repaired.stderr)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('duplicate workspace names cannot hide bundled CLI release requirements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-changeset-names-'))
  try {
    mkdirSync(join(dir, '.changeset'))
    mkdirSync(join(dir, 'scripts'))
    for (const name of ['check-changesets.mjs', 'changeset-metadata.mjs']) {
      writeFileSync(join(dir, 'scripts', name), readFileSync(new URL(`../../../scripts/${name}`, import.meta.url)))
    }
    for (const [directory, manifest] of Object.entries({
      core: { name: '@cavelang/core' },
      cli: { name: '@cavelang/cli', publishConfig: { exports: { './sync': './dist/internal/sync/index.js' } } },
      sync: { name: '@cavelang/sync', private: true },
      zz: { name: '@cavelang/cli', private: true }
    })) {
      mkdirSync(join(dir, 'packages', directory), { recursive: true })
      writeFileSync(join(dir, 'packages', directory, 'package.json'), JSON.stringify(manifest))
    }
    writeFileSync(join(dir, '.changeset/config.json'), JSON.stringify({ fixed: [['@cavelang/core', '@cavelang/cli']] }))
    const changeset = join(dir, '.changeset/valid.md')
    const duplicate = join(dir, 'packages/zz/package.json')
    writeFileSync(changeset, '---\n"@cavelang/core": patch\n"@cavelang/sync": minor\n---\n\nBundled change.\n')
    const check = () => spawnSync(process.execPath, ['scripts/check-changesets.mjs', '.changeset/valid.md'], { cwd: dir, encoding: 'utf8' })
    const invalid = check()
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /packages\/zz\/package.json duplicates package name @cavelang\/cli/)
    writeFileSync(duplicate, JSON.stringify({ name: '@cavelang/zz', private: true }))
    const ownerMissing = check()
    assert.equal(ownerMissing.status, 1)
    assert.match(ownerMissing.stderr, /name @cavelang\/cli at the same or higher severity/)
    writeFileSync(changeset, '---\n"@cavelang/cli": minor\n"@cavelang/sync": minor\n---\n\nBundled change.\n')
    assert.equal(check().status, 0)
    for (const name of [undefined, null, 42, '']) {
      const manifest = JSON.stringify({ name, private: true })
      writeFileSync(duplicate, manifest)
      const result = check()
      assert.equal(result.status, 1)
      assert.match(result.stderr, /packages\/zz\/package.json has no package name/)
      assert.equal(readFileSync(duplicate, 'utf8'), manifest)
    }
    writeFileSync(duplicate, JSON.stringify({ name: '@cavelang/zz', private: true }))
    assert.equal(check().status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
