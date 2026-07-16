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

type Manifest = {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown>
  publishConfig?: { exports?: Record<string, unknown> }
  scripts?: Record<string, string>
}
type Tsconfig = { references?: { path: string }[] }
type Surface = {
  consumer?: string
  published?: boolean
  replacement?: string
  stability?: string
}
type Surfaces = {
  public: Record<string, Surface>
  internal: Record<string, Surface>
  tooling: Record<string, Surface>
}
type ChangesetConfig = { fixed: string[][] }

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

test('package test globs use shell-portable quoting', () => {
  for (const name of readdirSync(packagesDir).sort()) {
    const path = join(packagesDir, name, 'package.json')
    if (!existsSync(path)) continue
    const script = parse<Manifest>(path).scripts?.test
    if (script === undefined) continue
    assert.doesNotMatch(
      script,
      /'[^']*[*?][^']*'/,
      `packages/${name}/package.json passes POSIX single quotes literally on Windows: ${script}`
    )
  }
})

test('the stable CI check and release script both require packed-artifact smoke tests', () => {
  const ci = readFileSync(fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)), 'utf8')
  assert.match(ci, /\n  smoke:\n[\s\S]*?bash scripts\/smoke\.sh/)
  assert.match(ci, /\n  test:\n[\s\S]*?needs:\n      - suite\n      - smoke/)

  const release = readFileSync(fileURLToPath(new URL('../../../scripts/release-publish.sh', import.meta.url)), 'utf8')
  const smoke = release.indexOf('bash scripts/smoke.sh')
  const recoveryTag = release.indexOf('ensure_tag #', smoke)
  const publish = release.indexOf('pnpm -r publish', smoke)
  const finalTag = release.indexOf('\nensure_tag', publish)
  assert.ok(smoke >= 0, 'release must run the shared packed-artifact smoke test')
  assert.ok(recoveryTag > smoke, 'interrupted-release tagging must follow smoke validation')
  assert.ok(publish > smoke, 'npm publishing must follow smoke validation')
  assert.ok(finalTag > publish, 'normal release tagging must follow npm publishing')
})

test('every package has one enforced public, internal, or tooling classification', () => {
  const surfaces = parse<Surfaces>(fileURLToPath(new URL('../../../package-surfaces.json', import.meta.url)))
  const classified = [...Object.keys(surfaces.public), ...Object.keys(surfaces.internal), ...Object.keys(surfaces.tooling)]
  assert.equal(new Set(classified).size, classified.length, 'surface classifications must not overlap')
  const manifests = readdirSync(packagesDir).sort()
    .map(name => join(packagesDir, name, 'package.json'))
    .filter(existsSync)
    .map(path => parse<Manifest>(path))
  assert.deepEqual(classified.sort(), manifests.map(manifest => manifest.name!).sort())

  const published = new Set([
    ...Object.keys(surfaces.public),
    ...Object.entries(surfaces.tooling).filter(([, surface]) => surface.published).map(([name]) => name)
  ])
  assert.deepEqual(
    manifests.filter(manifest => manifest.private !== true).map(manifest => manifest.name!).sort(),
    [...published].sort(),
    'only classified public packages may reach npm'
  )
  const changesets = parse<ChangesetConfig>(fileURLToPath(new URL('../../../.changeset/config.json', import.meta.url)))
  assert.deepEqual(changesets.fixed.flat().sort(), [...published].sort(), 'the release lockstep must contain only public packages')
  for (const name of published) {
    const surface = surfaces.public[name] ?? surfaces.tooling[name]!
    assert.ok(surface.consumer, `${name} needs an independent consumer`)
    assert.ok(surface.stability, `${name} needs a stability promise`)
  }
})

test('retired package names are private and built into documented CLI subpaths', () => {
  const surfaces = parse<Surfaces>(fileURLToPath(new URL('../../../package-surfaces.json', import.meta.url)))
  const retired = new Map([
    ...Object.entries(surfaces.internal),
    ...Object.entries(surfaces.tooling).filter(([, surface]) => surface.published === false)
  ])
  const cli = parse<Manifest>(join(packagesDir, 'cli', 'package.json'))
  for (const [name, surface] of retired) {
    const directory = name.slice('@cavelang/'.length)
    const manifest = parse<Manifest>(join(packagesDir, directory, 'package.json'))
    assert.equal(manifest.private, true, `${name} must not publish independently`)
    const subpath = surface.replacement?.replace('@cavelang/cli', '.')
    assert.ok(subpath && cli.exports?.[subpath], `${surface.replacement} must be exported`)
    assert.ok(subpath && cli.publishConfig?.exports?.[subpath], `${surface.replacement} must ship emitted code`)
    assert.equal(cli.devDependencies?.[name], 'workspace:*', `${name} must remain a workspace build boundary`)
  }
})
