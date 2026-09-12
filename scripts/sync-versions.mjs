#!/usr/bin/env node
// Propagates the lockstep version to version sources that `changeset
// version` does not manage consistently: private package manifests, the
// private root and VS Code manifests, and tree-sitter grammar metadata. Runs as part of `pnpm run
// version-packages` so the version packages PR carries every version
// source in one commit.
//
// Changesets can version private packages under packages/, but this script
// brings every one to the fixed-group version. The ignored website has no
// released artifact version; the ignored VS Code manifest is updated
// here only after Changesets has finished so its Marketplace artifact shares
// the repository release identity without entering the npm fixed group.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.env.CAVE_RELEASE_ROOT ?? join(import.meta.dirname, '..'))

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const releaseType = (previous, next) => {
  const [previousMajor, previousMinor] = previous.split('.').map(Number)
  const [nextMajor, nextMinor] = next.split('.').map(Number)
  if (nextMajor !== previousMajor) return 'Major'
  if (nextMinor !== previousMinor) return 'Minor'
  return 'Patch'
}

// @cavelang/core is in the fixed group, so it always carries the current
// lockstep version after `changeset version` has run.
const version = read(join(root, 'packages/core/package.json')).version
// Changesets leaves the private root untouched, so it identifies the last
// lockstep release even after individual private packages have been bumped.
const rootManifestPath = join(root, 'package.json')
const rootManifest = read(rootManifestPath)
const after = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  const differing = a.findIndex((value, index) => value !== b[index])
  return differing >= 0 && a[differing] > b[differing]
}

// The action reads a changelog entry for every version-changed workspace,
// including private packages advanced only by this synchronizer.
const alignChangelog = (directory, name, previousVersion, description) => {
  const changelogPath = join(directory, 'CHANGELOG.md')
  const title = `# ${name}`
  const changelog = existsSync(changelogPath)
    ? readFileSync(changelogPath, 'utf8').trimEnd()
    : title
  const heading = `## ${version}`
  if (changelog.split('\n').includes(heading)) return
  // A private patch/minor bump below the fixed-group release is provisional,
  // not published history. Attribute its actual notes to the lockstep version.
  const firstVersion = /^## .+$/m.exec(changelog)
  if (after(previousVersion, rootManifest.version) && after(version, previousVersion) &&
      firstVersion?.[0] === `## ${previousVersion}`) {
    const start = firstVersion.index
    writeFileSync(changelogPath, changelog.slice(0, start) + heading +
      changelog.slice(start + firstVersion[0].length) + '\n')
    console.log(`${changelogPath}: ${previousVersion} -> ${version}`)
    return
  }
  const firstBreak = changelog.indexOf('\n')
  const header = firstBreak < 0 ? changelog : changelog.slice(0, firstBreak)
  const history = firstBreak < 0 ? '' : changelog.slice(firstBreak).trim()
  const entry = `${heading}\n\n### ${releaseType(previousVersion, version)} Changes\n\n` +
    `- Align ${description} with the CAVE ${version} release identity.`
  writeFileSync(changelogPath, `${header}\n\n${entry}${history.length > 0 ? `\n\n${history}` : ''}\n`)
  console.log(`${changelogPath}: ${version}`)
}

for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  const manifestPath = join(root, 'packages', entry.name, 'package.json')
  if (!entry.isDirectory() || !existsSync(manifestPath)) continue
  const manifest = read(manifestPath)
  if (manifest.version !== version) {
    alignChangelog(join(root, 'packages', entry.name), manifest.name, manifest.version, `the ${manifest.name} workspace`)
    manifest.version = version
    write(manifestPath, manifest)
    console.log(`packages/${entry.name}/package.json: ${version}`)
  }
}

if (rootManifest.version !== version) {
  rootManifest.version = version
  write(rootManifestPath, rootManifest)
  console.log(`package.json: ${version}`)
}

const vscodeManifestPath = join(root, 'editors/vscode/package.json')
const vscodeManifest = read(vscodeManifestPath)
if (vscodeManifest.version !== version) {
  // Keep the old manifest version on changelog failure so a retry still
  // creates the entry with the correct release severity.
  alignChangelog(join(root, 'editors/vscode'), vscodeManifest.name, vscodeManifest.version, 'the VS Code extension')
  vscodeManifest.version = version
  write(vscodeManifestPath, vscodeManifest)
  console.log(`editors/vscode/package.json: ${version}`)
}

const grammarPath = join(root, 'packages/tree-sitter-cave/tree-sitter.json')
const grammar = read(grammarPath)
if (grammar.metadata.version !== version) {
  grammar.metadata.version = version
  write(grammarPath, grammar)
  console.log(`packages/tree-sitter-cave/tree-sitter.json: ${version}`)
}
