import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { isSupportedNodeVersion } from '../src/doctor.ts'

const root = new URL('../../../', import.meta.url)
const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const read = (path: string): string =>
  readFileSync(new URL(path, root), 'utf8').replace(/\r\n?/g, '\n')

test('package engines name the exact minimum Node runtime', () => {
  const manifests = [
    'package.json',
    ...readdirSync(new URL('packages/', root), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(new URL(`packages/${entry.name}/package.json`, root)))
      .map(entry => `packages/${entry.name}/package.json`)
  ]
  let runtimePackages = 0
  for (const path of manifests) {
    const manifest = JSON.parse(read(path)) as { name?: string, engines?: { node?: string } }
    if (manifest.engines?.node === undefined) continue
    runtimePackages += 1
    assert.equal(manifest.engines.node, '^24.16.0 || ^26.1.0',
      `${manifest.name ?? path} has a divergent Node engine`)
  }
  assert.ok(runtimePackages > 20, 'the runtime contract did not inspect the package graph')
})

test('CI names exact runtimes and supported operating systems', () => {
  const ci = read('.github/workflows/ci.yml')
  for (const expected of ['24.21.0', '26.8.2', 'ubuntu-24.04', 'macos-15', 'windows-2022']) {
    assert.ok(ci.includes(expected), `CI omits supported runtime target ${expected}`)
  }
  assert.doesNotMatch(ci, /node: (?:24\.16\.0|26\.1\.0|26\.8\.1)\b/, 'CI uses only the selected releases')
  const runtime = ci.slice(ci.indexOf('\n  runtime:\n'))
  const runtimeJob = runtime.slice(0, runtime.indexOf('\n    steps:'))
  const jobMinutes = Number(/timeout-minutes: (\d+)/.exec(runtimeJob)?.[1])
  const stressMinutes = Number(/name: Verify Z3 cleanup under forced garbage collection\s+timeout-minutes: (\d+)/.exec(runtime)?.[1])
  assert.ok(stressMinutes >= 20, 'stress step must leave at least six minutes beyond the 14-minute cumulative solve budgets for compilation and cleanup')
  assert.ok(Number.isFinite(jobMinutes) && Number.isFinite(stressMinutes) && jobMinutes >= stressMinutes + 15,
    'runtime job must reserve at least 15 minutes around the complete stress-step budget for setup and other suites')
  const bootstrap = runtime.indexOf('node --test packages/mcp/test/bootstrap-native.test.ts')
  assert.ok(bootstrap >= 0 && bootstrap < runtime.indexOf('pnpm install --frozen-lockfile'),
    'the runtime matrix must exercise native bootstrap before installing dependencies')
  assert.doesNotMatch(ci, /node-version:\s*(?:22|24|26)\s*$/m, 'CI must not select a floating Node major')
  assert.doesNotMatch(ci, /runs-on:\s*(?:ubuntu|macos|windows)-latest/, 'CI must name exact runner images')
})

test('doctor accepts exactly the supported Node release lines', () => {
  for (const version of ['24.16.0', '24.21.0', '24.99.0', '26.1.0', '26.8.1']) {
    assert.equal(isSupportedNodeVersion(version), true, `${version} should be supported`)
  }
  for (const version of ['22.18.0', '22.99.0', '23.0.0', '24.0.0', '24.15.9', '25.9.0', '26.0.0', '27.0.0', 'invalid']) {
    assert.equal(isSupportedNodeVersion(version), false, `${version} should be unsupported`)
  }
  for (const version of ['26.0.0-nightly20260829abcdef01', '24.0.0-rc.1', '22.18.0-pre', 'v24.21.0', '24.18']) {
    assert.equal(isSupportedNodeVersion(version), false, `${version} is not a stable supported release`)
  }
})

test('every workflow job has an explicit timeout and Node workflows use the recommended LTS', () => {
  const selection = read('.nvmrc')
  assert.match(selection, /^24\.\d+\.\d+\n$/, 'local development must select one exact LTS version')
  const recommended = selection.trim()
  assert.equal(isSupportedNodeVersion(recommended), true)
  const workflows = readdirSync(new URL('.github/workflows/', root))
    .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
  for (const name of workflows) {
    const workflow = read(`.github/workflows/${name}`)
    const jobsIndex = workflow.indexOf('\njobs:\n')
    assert.notEqual(jobsIndex, -1, `${name} has no jobs mapping`)
    const jobs = workflow.slice(jobsIndex + '\njobs:\n'.length)
    const starts = [...jobs.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)]
    assert.ok(starts.length > 0, `${name} has no jobs`)
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]!
      const next = starts[index + 1]
      const block = jobs.slice(start.index, next?.index ?? jobs.length)
      assert.match(block, /^    timeout-minutes:\s*[1-9]\d*\s*$/m,
        `${name} job ${start[1]} has no deliberate timeout`)
    }
    for (const match of workflow.matchAll(/node-version:\s*([^\n#]+)/g)) {
      const version = match[1]!.trim()
      assert.ok(version === recommended || version === '${{ matrix.node }}',
        `${name} selects unsupported Node version ${version}`)
    }
  }
})

test('runtime documentation agrees with the tested support policy', () => {
  for (const path of ['README.md', 'ARCHITECTURE.md', 'IMPLEMENTATION.md', 'packages/cli/README.md']) {
    const document = read(path).replace(/\s+/g, ' ')
    for (const expected of ['24.16.0', '24.21.0', '26.1.0', '26.8.2', 'Ubuntu 24.04', 'macOS 15', 'Windows Server 2022']) {
      assert.ok(document.includes(expected), `${path} omits ${expected}`)
    }
  }
})

test('binary: Node warnings are quiet by default and visible with CAVE_DEBUG', () => {
  for (const debug of ['0', '1']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `process.argv = [process.execPath, ${JSON.stringify(main)}, 'version']; await import(${JSON.stringify(new URL('../src/main.ts', import.meta.url).href)}); process.emitWarning('runtime warning probe', 'ExperimentalWarning')`], {
      encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', CAVE_DEBUG: debug }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/)
    if (debug === '0') assert.equal(result.stderr, '')
    else assert.match(result.stderr, /runtime warning probe/)
  }
})

test('binary: version prints only the version without warning flags', () => {
  const result = spawnSync(process.execPath, [main, 'version'], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', CAVE_DEBUG: '0' }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/)
  assert.equal(result.stderr, '')
})

for (const disableWarnings of [false, true]) test(`binary: quiet warnings still reach preload subscribers (Node printer disabled: ${disableWarnings})`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-warning-listener-'))
  try {
    const preload = join(dir, 'preload.cjs')
    writeFileSync(preload, `
      process.prependListener('warning', function onWarning(warning) {
        if (warning.message === 'preload probe') process.stdout.write('telemetry received\\n')
      })
      process.on('warning', function onWarning(warning) {
        if (warning.message === 'preload probe') process.stdout.write('subscriber received\\n')
      })
    `)
    const result = spawnSync(process.execPath, [...(disableWarnings ? ['--no-warnings'] : []), '--require', preload, '--input-type=module', '-e',
      `process.argv = [process.execPath, ${JSON.stringify(main)}, 'version']; await import(${JSON.stringify(new URL('../src/main.ts', import.meta.url).href)}); process.emitWarning('preload probe')`], {
      encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', CAVE_DEBUG: '0' }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, /telemetry received\n/)
    assert.match(result.stdout, /subscriber received\n/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
