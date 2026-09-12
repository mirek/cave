import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const errorMessage = error => {
  try {
    const message = error instanceof Error ? error.message : undefined
    return typeof message === 'string' ? message : String(error)
  } catch { return '[unprintable thrown value]' }
}

function runNpm(args, cwd) {
  // All arguments are fixed below; cmd.exe is needed for npm.cmd on Windows.
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd, stdio: 'inherit', shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed (${result.signal ?? result.status})`)
}

export function auditPublishedPackages(root = scriptRoot, run = runNpm, remove = rmSync) {
  const dependencies = {}
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const manifest = JSON.parse(readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8'))
    if (manifest.private === true) continue
    if (typeof manifest.name !== 'string' || !/^@cavelang\/[a-z0-9-]+$/.test(manifest.name) ||
        typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
      throw new Error(`Invalid public package identity: ${entry.name}`)
    }
    if (Object.hasOwn(dependencies, manifest.name)) throw new Error(`Duplicate public package: ${manifest.name}`)
    dependencies[manifest.name] = manifest.version
  }
  if (Object.keys(dependencies).length === 0) throw new Error('No public packages to audit')
  const directory = mkdtempSync(join(tmpdir(), 'cave-release-audit-'))
  let failed = false, failure
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: 'cave-release-audit', version: '0.0.0', private: true, dependencies,
    }, null, 2) + '\n')
    run(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--include=prod', '--include=optional'], directory)
    run(['ls', '--depth=0'], directory)
    run(['audit', 'signatures'], directory)
  } catch (error) {
    failed = true
    failure = error
    throw error
  } finally {
    try { remove(directory, { recursive: true, force: true }) } catch (cleanupError) {
      if (!failed) throw cleanupError
      throw new AggregateError([failure, cleanupError],
        `${errorMessage(failure)}; temporary installation cleanup also failed: ${errorMessage(cleanupError)}`,
        { cause: failure })
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { auditPublishedPackages() }
  catch (error) {
    console.error(errorMessage(error))
    process.exitCode = 1
  }
}
