import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const { verifyIncrementalBuild } = await import(new URL('../../../scripts/verify-incremental-build.mjs', import.meta.url).href)
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '')
const references = JSON.parse(readFileSync(resolve(root, 'tsconfig.json'), 'utf8')).references as { path: string }[]
const completeOutput = references.map(reference => `Project '${resolve(root, reference.path, 'tsconfig.json')}' is up to date`).join('\n')

test('incremental verification anchors the project graph and launches Windows shims through cmd', () => {
  for (const platform of ['linux', 'win32']) {
    let called = false
    const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
    const result = verifyIncrementalBuild({ platform, env,
      run: (command: string, args: string[], options: { cwd: string, env: object }) => {
        called = true
        assert.equal(options.cwd, root)
        assert.equal(options.env, env)
        assert.equal(command, platform === 'win32' ? env.ComSpec : 'pnpm')
        assert.deepEqual(args, platform === 'win32' ? ['/d', '/s', '/c', 'pnpm exec tsc -b --dry --verbose'] :
          ['exec', 'tsc', '-b', '--dry', '--verbose'])
        return { status: 0, stdout: completeOutput, stderr: '' }
      }
    })
    assert.equal(called, true)
    assert.equal(result.code, 0)
  }
})

test('incremental verification requires explicit evidence for the whole root graph', () => {
  for (const stdout of ['', 'Version 5.9.3\n', "Project '/unrelated/tsconfig.json' is up to date\n",
    completeOutput.split('\n').slice(1).join('\n')]) {
    const result = verifyIncrementalBuild({ run: () => ({ status: 0, stdout, stderr: '' }) })
    assert.equal(result.code, 1)
    assert.match(result.error, /missing up-to-date evidence/)
  }
  assert.equal(verifyIncrementalBuild({ run: () => ({ status: 0, stdout: completeOutput.replaceAll('\n', '\r\n'), stderr: '' }) }).code, 0)
})

test('incremental verification reports pending projects and process failures', () => {
  const pending = verifyIncrementalBuild({ run: () => ({ status: 0, stdout: "A non-dry build would build project '/workspace/core/tsconfig.json'", stderr: '' }) })
  assert.equal(pending.code, 1)
  assert.match(pending.error, /would compile:[\s\S]*core\/tsconfig.json/)
  const failed = verifyIncrementalBuild({ run: () => ({ status: 2, stdout: 'compiler diagnostic', stderr: '' }) })
  assert.equal(failed.code, 2)
  assert.equal(failed.error, 'compiler diagnostic')
  const missing = verifyIncrementalBuild({ run: () => ({ status: null, error: new Error('spawn ENOENT') }) })
  assert.match(missing.error, /could not start: spawn ENOENT/)
  const signalled = verifyIncrementalBuild({ run: () => ({ status: null, signal: 'SIGTERM' }) })
  assert.equal(signalled.code, 1)
  assert.match(signalled.error, /SIGTERM/)
})

test('incremental verification reads real compiler results from checkout paths containing apostrophes', async () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "cave O'Brien build-"))
  try {
    mkdirSync(resolve(fixture, 'scripts'))
    mkdirSync(resolve(fixture, 'example'))
    const script = resolve(fixture, 'scripts/verify-incremental-build.mjs')
    copyFileSync(resolve(root, 'scripts/verify-incremental-build.mjs'), script)
    writeFileSync(resolve(fixture, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: './example' }] }))
    writeFileSync(resolve(fixture, 'example/tsconfig.json'), JSON.stringify({
      compilerOptions: { composite: true, types: [], outDir: 'dist' }, files: ['index.ts'],
    }))
    writeFileSync(resolve(fixture, 'example/index.ts'), 'export const value = 1\n')
    const compiler = resolve(root, 'node_modules/typescript/bin/tsc')
    const built = spawnSync(process.execPath, [compiler, '-b'], { cwd: fixture, encoding: 'utf8' })
    assert.equal(built.status, 0, built.stdout + built.stderr)
    const { verifyIncrementalBuild: verify } = await import(pathToFileURL(script).href)
    const run = () => spawnSync(process.execPath, [compiler, '-b', '--dry', '--verbose'], { cwd: fixture, encoding: 'utf8' })
    const current = verify({ run })
    assert.equal(current.code, 0, current.error)
    rmSync(resolve(fixture, 'example/dist'), { recursive: true })
    const pending = verify({ run })
    assert.equal(pending.code, 1)
    assert.ok(pending.error.replaceAll('\\', '/').includes(resolve(fixture, 'example/tsconfig.json').replaceAll('\\', '/')), pending.error)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
