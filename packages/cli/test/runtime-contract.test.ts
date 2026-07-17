import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import * as assert from 'node:assert/strict'

const root = new URL('../../../', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')

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
    assert.equal(manifest.engines.node, '^22.18.0 || ^24.0.0',
      `${manifest.name ?? path} has a divergent Node engine`)
  }
  assert.ok(runtimePackages > 20, 'the runtime contract did not inspect the package graph')
})

test('CI names exact runtimes and supported operating systems', () => {
  const ci = read('.github/workflows/ci.yml')
  for (const expected of ['22.18.0', '24.18.0', 'ubuntu-24.04', 'macos-15', 'windows-2022']) {
    assert.ok(ci.includes(expected), `CI omits supported runtime target ${expected}`)
  }
  assert.doesNotMatch(ci, /node-version:\s*(?:22|24)\s*$/m, 'CI must not select a floating Node major')
  assert.doesNotMatch(ci, /runs-on:\s*(?:ubuntu|macos|windows)-latest/, 'CI must name exact runner images')
})

test('every workflow job has an explicit timeout and Node workflows use the recommended LTS', () => {
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
      assert.ok(version === '24.18.0' || version === '${{ matrix.node }}',
        `${name} selects unsupported Node version ${version}`)
    }
  }
})

test('runtime documentation agrees with the tested support policy', () => {
  for (const path of ['README.md', 'ARCHITECTURE.md', 'IMPLEMENTATION.md', 'packages/cli/README.md']) {
    const document = read(path).replace(/\s+/g, ' ')
    for (const expected of ['22.18.0', '24.18.0', 'Ubuntu 24.04', 'macOS 15', 'Windows Server 2022']) {
      assert.ok(document.includes(expected), `${path} omits ${expected}`)
    }
  }
})
