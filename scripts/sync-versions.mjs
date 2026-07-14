#!/usr/bin/env node
// Propagates the lockstep version to manifests that `changeset version`
// does not manage: the private root package, the private workspace members
// (website, editors/vscode), and the tree-sitter grammar metadata. Runs as
// part of `pnpm run version-packages` so the Version Packages PR carries
// every version source in one commit.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')

// @cavelang/core is in the fixed group, so it always carries the current
// lockstep version after `changeset version` has run.
const version = read(join(root, 'packages/core/package.json')).version

for (const rel of ['package.json', 'website/package.json', 'editors/vscode/package.json']) {
  const path = join(root, rel)
  const manifest = read(path)
  if (manifest.version !== version) {
    manifest.version = version
    write(path, manifest)
    console.log(`${rel}: ${version}`)
  }
}

const grammarPath = join(root, 'packages/tree-sitter-cave/tree-sitter.json')
const grammar = read(grammarPath)
if (grammar.metadata.version !== version) {
  grammar.metadata.version = version
  write(grammarPath, grammar)
  console.log(`packages/tree-sitter-cave/tree-sitter.json: ${version}`)
}
