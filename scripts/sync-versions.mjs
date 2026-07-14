#!/usr/bin/env node
// Propagates the lockstep version to version sources that `changeset
// version` does not manage: the private root package.json (not a
// workspace member, so invisible to changesets tooling) and the
// tree-sitter grammar metadata. Runs as part of `pnpm run
// version-packages` so the version packages PR carries every version
// source in one commit.
//
// Deliberately NOT synced: website/ and editors/vscode/. They are
// private workspace members, so changesets/action treats any version
// change to them as a released package and tries to read their
// CHANGELOG.md (which changesets never writes for them) — that crashed
// the first release run. Nothing consumes their versions; the VS Code
// extension gets its own release lifecycle (todo/vscode-release-pipeline).

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

const grammarPath = join(root, 'packages/tree-sitter-cave/tree-sitter.json')
const grammar = read(grammarPath)
if (grammar.metadata.version !== version) {
  grammar.metadata.version = version
  write(grammarPath, grammar)
  console.log(`packages/tree-sitter-cave/tree-sitter.json: ${version}`)
}
