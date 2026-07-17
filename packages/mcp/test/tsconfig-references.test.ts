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
  version?: string
  private?: boolean
  packageManager?: string
  keywords?: string[]
  homepage?: string
  bugs?: { url?: string }
  engines?: { node?: string }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown>
  publishConfig?: { exports?: Record<string, unknown> }
  scripts?: Record<string, string>
  files?: string[]
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
type PerformanceBaseline = {
  format: string
  version: number
  workloads: Record<string, { baselineMs: number, thresholdMs: number }>
}

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

test('the root has one emitting build path and CI verifies clean and incremental behavior', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const manifest = parse<Manifest>(join(root, 'package.json'))
  assert.equal(manifest.scripts?.build, 'tsc -b')
  assert.equal(manifest.scripts?.typecheck, 'pnpm run build')
  assert.equal(manifest.scripts?.['build:verify'], 'node scripts/verify-incremental-build.mjs')

  const makefile = readFileSync(join(root, 'Makefile'), 'utf8')
  assert.match(makefile, /^typecheck: build$/m)
  assert.match(makefile, /^check: build test$/m)
  assert.doesNotMatch(makefile, /^typecheck:\n\tpnpm typecheck$/m)

  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const cleanBuild = ci.indexOf('run: pnpm clean && pnpm build')
  const verify = ci.indexOf('run: pnpm build:verify')
  const tests = ci.indexOf('run: pnpm test', verify)
  assert.ok(cleanBuild >= 0 && verify > cleanBuild && tests > verify)
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

test('every public package packs the canonical license and author files', () => {
  for (const name of readdirSync(packagesDir).sort()) {
    const path = join(packagesDir, name, 'package.json')
    if (!existsSync(path)) continue
    const manifest = parse<Manifest>(path)
    if (manifest.private === true) continue
    assert.ok(manifest.files?.includes('License.md'), `${manifest.name} does not pack License.md`)
    assert.ok(manifest.files?.includes('Authors.md'), `${manifest.name} does not pack Authors.md`)
    assert.match(
      manifest.scripts?.prepack ?? '',
      /^node \.\.\/\.\.\/scripts\/prepare-package-legal\.mjs && /,
      `${manifest.name} does not stage the canonical legal files before packing`
    )
  }

  const smoke = readFileSync(fileURLToPath(new URL('../../../scripts/smoke.sh', import.meta.url)), 'utf8')
  assert.match(smoke, /for legal_file in License\.md Authors\.md/)
  assert.match(smoke, /tar -xOf "\$tarball" "package\/\$legal_file" \| cmp -s - "\$root\/\$legal_file"/)
})

test('every public package exposes consistent discovery and support metadata', () => {
  const expectedKeywords = ['cave', 'knowledge-graph', 'knowledge-representation', 'typescript']
  for (const name of readdirSync(packagesDir).sort()) {
    const path = join(packagesDir, name, 'package.json')
    if (!existsSync(path)) continue
    const manifest = parse<Manifest>(path)
    if (manifest.private === true) continue
    assert.deepEqual(manifest.keywords, expectedKeywords, `${manifest.name} has inconsistent keywords`)
    assert.equal(manifest.homepage, 'https://github.com/mirek/cave#readme')
    assert.equal(manifest.bugs?.url, 'https://github.com/mirek/cave/issues')
  }
})

test('bootstrap and clean derive deterministic tooling from the root manifest', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const manifest = parse<Manifest>(join(root, 'package.json'))
  assert.match(manifest.packageManager ?? '', /^pnpm@\d+\.\d+\.\d+$/)
  assert.equal(manifest.scripts?.clean, 'node scripts/clean.mjs')

  const makefile = readFileSync(join(root, 'Makefile'), 'utf8')
  assert.match(makefile, /^bootstrap:\n\tnode scripts\/bootstrap\.mjs$/m)

  const bootstrap = readFileSync(join(root, 'scripts/bootstrap.mjs'), 'utf8')
  assert.match(bootstrap, /const \{ packageManager \} = JSON\.parse/)
  assert.match(bootstrap, /availableVersion\('corepack', \[manager, '--version'\]\)/)
  assert.match(bootstrap, /\['exec', '--yes', '--package', `\$\{manager\}@\$\{version\}`/)
  assert.doesNotMatch(bootstrap, /install -g|corepack enable/)

  const clean = readFileSync(join(root, 'scripts/clean.mjs'), 'utf8')
  for (const output of [
    "join(directory, 'dist')",
    "join(directory, 'License.md')",
    "join(directory, 'Authors.md')",
    "join(root, 'editors/vscode/dist')",
    "join(root, 'website/dist')",
    "join(root, 'packages/tree-sitter-cave/src')",
    "join(root, 'packages/tree-sitter-cave/tree-sitter-cave.wasm')",
    "entry.name.endsWith('.vsix')",
    "entry.name.endsWith('.tsbuildinfo')",
  ]) {
    assert.ok(clean.includes(output), `clean script omits ${output}`)
  }
})

test('all third-party workflow actions use reviewable immutable revisions', () => {
  const workflows = fileURLToPath(new URL('../../../.github/workflows', import.meta.url))
  for (const name of readdirSync(workflows).filter(name => name.endsWith('.yml')).sort()) {
    const source = readFileSync(join(workflows, name), 'utf8')
    const uses = source.split('\n').filter(line => /^\s*-?\s*uses:/.test(line))
    assert.ok(uses.length > 0, `${name} contains no action references`)
    for (const line of uses) {
      assert.match(line, /^\s*-?\s*uses:\s+[^\s@]+@[0-9a-f]{40}\s+#\s+v\d+\s*$/, `${name}: ${line.trim()}`)
    }
  }
})

test('the stable CI check and release script both require packed-artifact smoke tests', () => {
  const ci = readFileSync(fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)), 'utf8')
  assert.match(ci, /\n  smoke:\n[\s\S]*?bash scripts\/smoke\.sh/)
  assert.match(ci, /\n  test:\n[\s\S]*?needs:\n      - suite\n      - runtime\n      - smoke/)

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

test('packed smoke coverage owns child cleanup, type/API contracts, and major offline surfaces', () => {
  const smoke = readFileSync(fileURLToPath(new URL('../../../scripts/smoke.sh', import.meta.url)), 'utf8')
  const packedExports = readFileSync(fileURLToPath(new URL('../../../scripts/packed-exports.mjs', import.meta.url)), 'utf8')
  assert.match(smoke, /children=\(\)[\s\S]*trap cleanup EXIT/)
  assert.match(smoke, /children\+=\("\$serve_pid"\)/)
  for (const command of ['import', 'act', 'report', 'connect', 'mcp']) {
    assert.match(smoke, new RegExp(`echo "==> cave ${command}`), `packed smoke omits cave ${command}`)
  }
  assert.match(smoke, /scripts\/packed-contract\.mjs/)
  for (const specifier of [
    '@cavelang/canonical',
    '@cavelang/cli/act',
    '@cavelang/highlight/browser',
    '@cavelang/store',
    '@cavelang/store/adapter/node',
  ]) {
    assert.match(packedExports, new RegExp(`specifier: '${specifier.replaceAll('/', '\\/')}'`))
  }
  assert.match(smoke, /@cavelang\/tree-sitter-cave\/package\.json/)
  assert.match(smoke, /cave-solver-workflow architecture feasibility/)
  assert.match(smoke, /backend\?\.name !== 'z3-wasm'/)
})

test('the default website build excludes the optional solver runtime', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /Build website[\s\S]*Verify the default website excludes optional solver assets[\s\S]*verify-website-bundle\.mjs/)

  const website = parse<Manifest>(join(root, 'website/package.json'))
  assert.equal(website.dependencies?.['@cavelang/solver-z3'], undefined)
  assert.equal(website.dependencies?.['z3-solver'], undefined)
})

test('release automation validates identity before npm and matches the supported runtime', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const manifest = parse<Manifest>(join(root, 'package.json'))
  assert.equal(manifest.engines?.node, '^22.18.0 || ^24.0.0')
  assert.equal(manifest.scripts?.['release:validate'], 'node scripts/release-validate.mjs --mode=publish')
  assert.equal(manifest.scripts?.['release:validate:version-pr'],
    'node scripts/release-validate.mjs --mode=version-pr')

  const publishWorkflow = readFileSync(join(root, '.github/workflows/publish.yml'), 'utf8')
  const preflight = publishWorkflow.indexOf('Validate version-PR or publish readiness')
  const registry = publishWorkflow.indexOf('registry-url: https://registry.npmjs.org')
  assert.ok(preflight >= 0 && preflight < registry, 'release identity must be checked before npm registry setup')
  assert.deepEqual([...publishWorkflow.matchAll(/node-version: ([\d.]+)/g)].map(match => match[1]),
    ['24.18.0', '24.18.0'])

  const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.deepEqual([...ciWorkflow.matchAll(/node-version: ([\d.]+)/g)].map(match => match[1]),
    ['24.18.0', '24.18.0', '24.18.0'])
  assert.match(ciWorkflow, /node: 22\.18\.0/)
  assert.match(ciWorkflow, /node: 24\.18\.0/)
  for (const workflow of [publishWorkflow, ciWorkflow]) {
    assert.match(workflow, /path: ~\/\.cache\/tree-sitter/)
    assert.match(workflow, /tree-sitter-wasi-\$\{\{ runner\.os \}\}/)
  }

  const release = readFileSync(join(root, 'scripts/release-publish.sh'), 'utf8')
  const validation = release.indexOf('node scripts/release-validate.mjs --mode=publish')
  const registryLookup = release.indexOf('npm view')
  const build = release.indexOf('pnpm --filter @cavelang/tree-sitter-cave build')
  assert.ok(validation >= 0 && validation < registryLookup && validation < build)
  assert.match(release, /CAVE_NPM_VIEW_ATTEMPTS:-4/)
  assert.match(release, /npm view \$\{selector\} failed after \$\{attempts\} attempts/)
  assert.match(release, /registry_has "\$\{name\}@\$\{version\}" version "\$version" true/)
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8')
  assert.match(makefile, /publish:\n\tpnpm release:publish/)
  assert.doesNotMatch(makefile, /publish:[^\n]*\n\tpnpm -r publish/)
})

test('the VS Code extension is packed, versioned, and published through a scoped release path', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const editor = parse<Manifest>(join(root, 'editors/vscode/package.json'))
  assert.equal(editor.private, true)
  assert.equal(editor.scripts?.package, 'pnpm run build && node package.mjs')
  assert.equal(editor.devDependencies?.yauzl, '^3.2.0')

  const packager = readFileSync(join(root, 'editors/vscode/package.mjs'), 'utf8')
  assert.match(packager, /'vsce',\n  'package'/)
  assert.match(packager, /await verifyVsix\(output, manifest\.version\)/)
  const verifier = readFileSync(join(root, 'editors/vscode/verify-vsix.mjs'), 'utf8')
  for (const asset of ['extension.js', 'web-tree-sitter.wasm', 'tree-sitter-cave.wasm', 'highlights.scm']) {
    assert.match(verifier, new RegExp(asset.replace('.', '\\.')))
  }

  const sync = readFileSync(join(root, 'scripts/sync-versions.mjs'), 'utf8')
  assert.match(sync, /editors\/vscode\/package\.json/)
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /\n  vscode:\n[\s\S]*pnpm --filter cave-language package[\s\S]*actions\/upload-artifact@[0-9a-f]{40}/)
  assert.match(ci, /needs:\n      - suite\n      - runtime\n      - smoke\n      - vscode/)

  const release = readFileSync(join(root, '.github/workflows/vscode.yml'), 'utf8')
  assert.match(release, /^permissions:\n  contents: read$/m)
  assert.match(release, /environment: vscode-marketplace/)
  assert.match(release, /ref: refs\/tags\/v\$\{\{ inputs\.version \}\}/)
  assert.match(release, /node scripts\/release-validate\.mjs --mode=publish/)
  assert.match(release, /VSCE_PAT: \$\{\{ secrets\.VSCE_PAT \}\}/)
  assert.match(release, /vsce publish .*--skip-duplicate/)
})

test('CI runs every recorded representative performance budget', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const manifest = parse<Manifest>(join(root, 'package.json'))
  assert.equal(manifest.scripts?.['bench:performance'],
    'node --disable-warning=ExperimentalWarning scripts/performance-bench.mjs')
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /Check representative performance budgets\n        run: pnpm bench:performance/)

  const baseline = parse<PerformanceBaseline>(join(root, 'benchmarks/performance-baseline.json'))
  assert.equal(baseline.format, 'cave.performance-baseline')
  assert.equal(baseline.version, 1)
  assert.deepEqual(Object.keys(baseline.workloads).sort(), [
    'boundedQuery', 'export', 'import', 'resolution', 'restrictedViewLarge',
    'scopedViewLargeCold', 'scopedViewLargeWarm', 'scopedViewSmall', 'shape', 'transitiveQuery'
  ])
  for (const [name, budget] of Object.entries(baseline.workloads)) {
    assert.ok(budget.baselineMs > 0, `${name} needs a positive recorded baseline`)
    assert.ok(budget.thresholdMs >= budget.baselineMs, `${name} threshold is below its baseline`)
    assert.ok(budget.thresholdMs <= budget.baselineMs * 25, `${name} threshold is too loose to catch regressions`)
  }
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
