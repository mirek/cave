#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(process.env.CAVE_RELEASE_ROOT ?? scriptRoot)
const conditional = process.argv.includes('--if-release-ready')

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
const committedJson = path => JSON.parse(git('show', `HEAD:${path}`))

try {
  const pending = git('ls-tree', '-r', '--name-only', 'HEAD', '.changeset')
    .split('\n')
    .filter(path => /^\.changeset\/.*\.md$/.test(path) && path !== '.changeset/README.md')

  runGit(['fetch', '--quiet', '--tags', 'origin', 'main'])

  const head = git('rev-parse', 'HEAD')
  const remoteMain = git('rev-parse', 'refs/remotes/origin/main')
  if (runGit(['merge-base', '--is-ancestor', head, remoteMain], { allowFailure: true }).status !== 0) {
    fail(`release commit ${head} is not reachable from origin/main (${remoteMain})`)
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    if (process.env.GITHUB_REF !== 'refs/heads/main') {
      fail(`releases must run from refs/heads/main, received ${process.env.GITHUB_REF || '<unset>'}`)
    }
    if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== head) {
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
  if (runGit(['diff', '--quiet', 'HEAD', '--', ...versionPaths], { allowFailure: true }).status !== 0) {
    fail('release version sources differ from their committed contents')
  }

  const rootManifest = committedJson('package.json')
  const version = rootManifest.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`root package.json has invalid committed version ${JSON.stringify(version)}`)
  }
  for (const path of manifestPaths) {
    const manifest = committedJson(path)
    if (manifest.private !== true && manifest.version !== version) {
      fail(`${path} is at committed version ${manifest.version}, expected ${version}`)
    }
  }
  const grammarVersion = committedJson('packages/tree-sitter-cave/tree-sitter.json').metadata?.version
  if (grammarVersion !== version) {
    fail(`packages/tree-sitter-cave/tree-sitter.json is at committed version ${grammarVersion}, expected ${version}`)
  }
  const vscodeVersion = committedJson('editors/vscode/package.json').version
  // Ordinary changeset-bearing commits precede the automated version PR, so
  // the extension may still carry the previous released version here. The
  // version PR runs sync-versions.mjs and must align it before publishing.
  if (vscodeVersion !== version && !(conditional && pending.length > 0)) {
    fail(`editors/vscode/package.json is at committed version ${vscodeVersion}, expected ${version}`)
  }

  let versionCommit
  for (const commit of git('rev-list', '--first-parent', 'HEAD', '--', 'package.json').split('\n')) {
    const candidateVersion = JSON.parse(git('show', `${commit}:package.json`)).version
    if (candidateVersion === version) versionCommit = commit
    else if (versionCommit !== undefined) break
  }
  if (versionCommit === undefined) fail(`could not locate the commit that introduced version ${version}`)

  const tag = `v${version}`
  const tagResult = runGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { allowFailure: true })
  if (tagResult.status === 0) {
    const tagCommit = tagResult.stdout.trim()
    if (tagCommit !== versionCommit) fail(`${tag} points to ${tagCommit}, not version commit ${versionCommit}`)
  }

  if (conditional && pending.length > 0) {
    console.log(`release preflight skipped: ${pending.length} pending changeset(s) require a version PR`)
    process.exit(0)
  }
  if (head !== versionCommit) {
    fail(`${tag} cannot be released from ${head}; rerun the workflow for version commit ${versionCommit}`)
  }

  console.log(`release preflight ok: ${tag} at ${head}`)
} catch (error) {
  console.error(`release preflight failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
