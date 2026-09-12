#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parseChangeset, validateChangeset } from './changeset-metadata.mjs'

try {
  const paths = process.argv.slice(2)
  if (paths.length === 0) throw new Error('usage: check-changesets.mjs <changeset.md>...')
  const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'))
  if (!Array.isArray(config.fixed) || config.fixed.length !== 1 || !Array.isArray(config.fixed[0])) {
    throw new Error('.changeset/config.json must contain one fixed release group')
  }
  const manifests = readdirSync('packages', { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(`packages/${entry.name}/package.json`))
    .map(entry => {
      const path = `packages/${entry.name}/package.json`
      return { path, manifest: JSON.parse(readFileSync(path, 'utf8')) }
    })
  const names = new Set()
  for (const { path, manifest } of manifests) {
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${path} has no package name`)
    }
    if (names.has(manifest.name)) throw new Error(`${path} duplicates package name ${manifest.name}`)
    names.add(manifest.name)
  }
  const fixed = new Set(config.fixed[0])
  const publicNames = manifests.filter(entry => entry.manifest.private !== true)
    .map(entry => entry.manifest.name).sort()
  const members = [...config.fixed[0]].sort()
  if (fixed.size !== members.length || members.length !== publicNames.length ||
      members.some((name, index) => name !== publicNames[index])) {
    throw new Error('.changeset/config.json fixed group must contain every public package exactly once')
  }
  for (const path of paths) {
    validateChangeset(path, parseChangeset(readFileSync(path, 'utf8'), path), manifests, fixed)
  }
  console.log(`changeset metadata valid: ${paths.length} file(s)`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
