#!/usr/bin/env node
// Propagates the lockstep version to version sources that `changeset
// version` does not manage: the private root and VS Code manifests and
// the tree-sitter grammar metadata. Runs as part of `pnpm run
// version-packages` so the version packages PR carries every version
// source in one commit.
//
// Changesets still does not manage either private workspace member. The
// website has no released artifact version; the VS Code manifest is updated
// here only after Changesets has finished so its Marketplace artifact shares
// the repository release identity without entering the npm fixed group.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')

// @cavelang/core is in the fixed group, so it always carries the current
// lockstep version after `changeset version` has run.
const version = read(join(root, 'packages/core/package.json')).version

const rootManifestPath = join(root, 'package.json')
const rootManifest = read(rootManifestPath)
if (rootManifest.version !== version) {
  rootManifest.version = version
  write(rootManifestPath, rootManifest)
  console.log(`package.json: ${version}`)
}

const vscodeManifestPath = join(root, 'editors/vscode/package.json')
const vscodeManifest = read(vscodeManifestPath)
if (vscodeManifest.version !== version) {
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
