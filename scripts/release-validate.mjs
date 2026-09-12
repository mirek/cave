#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseChangeset, validateChangeset } from './changeset-metadata.mjs'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(process.env.CAVE_RELEASE_ROOT ?? scriptRoot)
const args = process.argv.slice(2)
const mode = args.length === 1 && args[0].startsWith('--mode=') ? args[0].slice('--mode='.length) : undefined
const modes = new Set(['version-pr', 'publish'])
const selectedTag = process.env.CAVE_RELEASE_TAG || undefined

const runGit = (args, { allowFailure = false } = {}) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return result
}

const git = (...args) => runGit(args).stdout.trim()
const fail = message => { throw new Error(message) }
const committedText = path => runGit(['show', `HEAD:${path}`]).stdout
const committedJson = path => JSON.parse(committedText(path))
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const sameMembers = (actual, expected) =>
  actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index])


try {
  if (!modes.has(mode)) {
    fail('usage: release-validate.mjs --mode=version-pr|publish')
  }

  if (selectedTag !== undefined && (mode !== 'publish' ||
      process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch')) {
    fail('selected release tag requires a manual publish workflow')
  }
  if (selectedTag !== undefined && (!selectedTag.startsWith('v') || !semver.test(selectedTag.slice(1)))) {
    fail('selected release tag must be v<version>')
  }

  const pending = runGit(['ls-tree', '-r', '--name-only', '-z', 'HEAD', '.changeset']).stdout
    .split('\0')
    .filter(path => path.startsWith('.changeset/') && path.endsWith('.md') && path !== '.changeset/README.md')

  runGit(['fetch', '--quiet', '--tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'])

  const head = git('rev-parse', 'HEAD')
  const remoteMain = git('rev-parse', 'refs/remotes/origin/main')
  if (runGit(['merge-base', '--is-ancestor', head, remoteMain], { allowFailure: true }).status !== 0) {
    fail(`release commit ${head} is not reachable from origin/main (${remoteMain})`)
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    if (process.env.GITHUB_REF !== 'refs/heads/main') {
      fail(`releases must run from refs/heads/main, received ${process.env.GITHUB_REF || '<unset>'}`)
    }
    if (selectedTag !== undefined) {
      const target = runGit(['rev-parse', '--verify', '--quiet', `refs/tags/${selectedTag}^{commit}`], { allowFailure: true })
      if (target.status !== 0 || target.stdout.trim() !== head) {
        fail(`selected release tag ${selectedTag} does not identify checkout ${head}`)
      }
    }
    if (selectedTag === undefined && process.env.GITHUB_SHA && process.env.GITHUB_SHA !== head) {
      fail(`GITHUB_SHA ${process.env.GITHUB_SHA} does not match checkout ${head}`)
    }
  } else {
    const branchResult = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
    const branch = branchResult.status === 0 ? branchResult.stdout.trim() : undefined
    if (branch !== undefined && branch !== 'main') {
      fail(`releases must run from main or a detached main commit, received ${branch}`)
    }
  }

  const manifestPaths = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')))
    .map(entry => `packages/${entry.name}/package.json`)
    .sort()
  const versionPaths = [
    'package.json',
    ...manifestPaths,
    'packages/tree-sitter-cave/tree-sitter.json',
    'editors/vscode/package.json',
  ]
  const releaseInputPaths = [...versionPaths, '.changeset/config.json', ...pending]
  if (runGit(['diff', '--quiet', 'HEAD', '--', ...releaseInputPaths], { allowFailure: true }).status !== 0) {
    fail('release inputs differ from their committed contents')
  }

  if (mode === 'publish' && git('status', '--porcelain', '--untracked-files=normal').length > 0) {
    fail('publish requires a clean tracked and untracked worktree; use a clean checkout of the version commit')
  }

  const manifests = manifestPaths.map(path => ({ path, manifest: committedJson(path) }))
  const packageByName = new Map()
  for (const entry of manifests) {
    const { name, version } = entry.manifest
    if (typeof name !== 'string' || name.length === 0) fail(`${entry.path} has no package name`)
    if (packageByName.has(name)) fail(`${entry.path} duplicates package name ${name}`)
    if (typeof version !== 'string' || !semver.test(version)) {
      fail(`${entry.path} has invalid committed version ${JSON.stringify(version)}`)
    }
    packageByName.set(name, entry)
  }

  const publicNames = manifests
    .filter(entry => entry.manifest.private !== true)
    .map(entry => entry.manifest.name)
    .sort()
  const config = committedJson('.changeset/config.json')
  if (!Array.isArray(config.fixed) || config.fixed.length !== 1 || !Array.isArray(config.fixed[0])) {
    fail('.changeset/config.json must contain one fixed release group')
  }
  if (!sameMembers(config.fixed[0], publicNames)) {
    fail('.changeset/config.json fixed group must contain every public package exactly once')
  }
  if (config.baseBranch !== 'main' || config.access !== 'public' || config.updateInternalDependencies !== 'patch') {
    fail('.changeset/config.json has incompatible release settings')
  }

  const fixedGroup = new Set(config.fixed[0])
  for (const path of pending) {
    const releases = parseChangeset(committedText(path), path)
    validateChangeset(path, releases, manifests, fixedGroup)
  }

  for (const { path, manifest } of manifests) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (packageByName.has(name) && range !== 'workspace:*') {
          fail(`${path} ${section}.${name} is ${JSON.stringify(range)}, expected "workspace:*"`)
        }
      }
    }
  }

  if (mode === 'version-pr') {
    if (pending.length === 0) fail('version-PR validation requires at least one pending changeset')
    console.log(`version-PR preflight ok: ${pending.length} pending changeset(s) can repair the release identity`)
    process.exit(0)
  }

  if (pending.length > 0) {
    fail(`publish validation requires the version PR to consume ${pending.length} pending changeset(s)`)
  }

  const rootManifest = committedJson('package.json')
  const version = rootManifest.version
  if (typeof version !== 'string' || !semver.test(version)) {
    fail(`root package.json has invalid committed version ${JSON.stringify(version)}`)
  }
  for (const { path, manifest } of manifests) {
    if (manifest.version !== version) {
      fail(`${path} is at committed version ${manifest.version}, expected ${version}`)
    }
    if (manifest.private !== true) {
      const changelogPath = path.replace(/package\.json$/, 'CHANGELOG.md')
      const changelogResult = runGit(['show', `HEAD:${changelogPath}`], { allowFailure: true })
      if (changelogResult.status !== 0 || !new RegExp(`^## ${version.replace(/\./g, '\\.')}$`, 'm').test(changelogResult.stdout)) {
        fail(`${changelogPath} has no release entry for ${version}`)
      }
    }
  }
  const grammarVersion = committedJson('packages/tree-sitter-cave/tree-sitter.json').metadata?.version
  if (grammarVersion !== version) {
    fail(`packages/tree-sitter-cave/tree-sitter.json is at committed version ${grammarVersion}, expected ${version}`)
  }
  const vscodeVersion = committedJson('editors/vscode/package.json').version
  if (vscodeVersion !== version) {
    fail(`editors/vscode/package.json is at committed version ${vscodeVersion}, expected ${version}`)
  }
  const vscodeChangelog = runGit(['show', 'HEAD:editors/vscode/CHANGELOG.md'], { allowFailure: true })
  if (vscodeChangelog.status !== 0 ||
      !new RegExp(`^## ${version.replace(/\./g, '\\.')}$`, 'm').test(vscodeChangelog.stdout)) {
    fail(`editors/vscode/CHANGELOG.md has no release entry for ${version}`)
  }

  let versionCommit
  for (const commit of git('rev-list', '--first-parent', 'HEAD', '--', 'package.json').split('\n')) {
    const candidateVersion = JSON.parse(git('show', `${commit}:package.json`)).version
    if (candidateVersion === version) versionCommit = commit
    else if (versionCommit !== undefined) break
  }
  if (versionCommit === undefined) fail(`could not locate the commit that introduced version ${version}`)

  const tag = `v${version}`
  if (selectedTag !== undefined && selectedTag !== tag) {
    fail(`selected release tag ${selectedTag} does not match committed version ${tag}`)
  }
  const tagResult = runGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { allowFailure: true })
  if (tagResult.status === 0) {
    const tagCommit = tagResult.stdout.trim()
    if (tagCommit !== versionCommit) fail(`${tag} points to ${tagCommit}, not version commit ${versionCommit}`)
  }
  if (head !== versionCommit) {
    fail(`${tag} cannot be released from ${head}; rerun the workflow for version commit ${versionCommit}`)
  }

  console.log(`publish preflight ok: ${tag} at ${head}`)
} catch (error) {
  console.error(`release preflight failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
