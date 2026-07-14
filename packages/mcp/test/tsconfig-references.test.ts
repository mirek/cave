import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// A composite project that imports a workspace package without a direct
// project reference only typechecks while some other reference happens to
// pull that package into the build graph, so a clean or filtered `tsc -b`
// breaks (or reads stale outputs) once that incidental path changes.
// Non-TypeScript packages (no tsconfig.json) sit outside the graph.

const packagesDir = fileURLToPath(new URL('../..', import.meta.url))

type Manifest = { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
type Tsconfig = { references?: { path: string }[] }

const parse = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

const composite = readdirSync(packagesDir)
  .filter(name => existsSync(join(packagesDir, name, 'tsconfig.json')))
  .sort()

const referencesOf = (name: string): string[] =>
  (parse<Tsconfig>(join(packagesDir, name, 'tsconfig.json')).references ?? [])
    .map(reference => reference.path.replace(/^\.\.\//, ''))

const workspaceDependenciesOf = (name: string): string[] => {
  const manifest = parse<Manifest>(join(packagesDir, name, 'package.json'))
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter(dependency => dependency.startsWith('@cavelang/'))
    .map(dependency => dependency.slice('@cavelang/'.length))
}

test('every workspace dependency on a composite project is a direct project reference', () => {
  for (const name of composite) {
    const references = referencesOf(name)
    const missing = workspaceDependenciesOf(name)
      .filter(dependency => composite.includes(dependency))
      .filter(dependency => !references.includes(dependency))
    assert.deepEqual(missing, [], `packages/${name}/tsconfig.json is missing references: ${missing.join(', ')}`)
  }
})

test('every project reference is a declared workspace dependency', () => {
  for (const name of composite) {
    const dependencies = workspaceDependenciesOf(name)
    const undeclared = referencesOf(name).filter(reference => !dependencies.includes(reference))
    assert.deepEqual(undeclared, [], `packages/${name}/tsconfig.json references undeclared packages: ${undeclared.join(', ')}`)
  }
})

test('the root solution references every composite package', () => {
  const root = parse<Tsconfig>(fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)))
  const referenced = (root.references ?? []).map(reference => reference.path.replace(/^packages\//, ''))
  const missing = composite.filter(name => !referenced.includes(name))
  assert.deepEqual(missing, [], `root tsconfig.json is missing references: ${missing.join(', ')}`)
})
