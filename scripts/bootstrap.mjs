import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { packageManager, engines } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Bootstrap runs before dependencies exist, so validate the repository's
// positive-major caret ranges without importing a workspace or semver package.
const minimums = typeof engines?.node === 'string' ? engines.node.split('||').map(range => {
  const match = /^\^([1-9]\d*)\.(\d+)\.(\d+)$/.exec(range.trim())
  return match === null ? undefined : match.slice(1).map(Number)
}) : []
if (minimums.length === 0 || minimums.some(parts => parts === undefined || parts.some(part => !Number.isSafeInteger(part)))) {
  throw new Error('package.json engines.node must declare exact positive-major caret ranges')
}
const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(process.versions.node)?.slice(1).map(Number)
const supported = current !== undefined && minimums.some(([major, minor, patch]) =>
  current[0] === major && (current[1] > minor || (current[1] === minor && current[2] >= patch)))
if (!supported) {
  console.error(`Bootstrap requires Node ${engines.node}; found ${process.versions.node}. Select the recommended version in .nvmrc before retrying.`)
  process.exit(1)
}

const match = /^(pnpm)@(\d+\.\d+\.\d+)$/.exec(packageManager ?? '')

if (!match) {
  throw new Error(`package.json must declare an exact pnpm packageManager version; received ${packageManager ?? 'nothing'}`)
}

const [, manager, version] = match

const run = (command, args, options = {}) => {
  // These command tokens are fixed below; the only manifest-derived token is
  // the validated numeric pnpm version. Windows package-manager shims need cmd.
  const windows = process.platform === 'win32'
  return spawnSync(windows ? process.env.ComSpec ?? 'cmd.exe' : command,
    windows ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args, {
      cwd: root,
      encoding: 'utf8',
      ...options,
    })
}

const availableVersion = (command, args) => {
  const result = run(command, args)
  return result.status === 0 ? result.stdout.trim() : undefined
}

let command
let prefix

if (availableVersion(manager, ['--version']) === version) {
  command = manager
  prefix = []
} else if (availableVersion('corepack', [manager, '--version']) === version) {
  command = 'corepack'
  prefix = [manager]
} else {
  command = 'npm'
  prefix = ['exec', '--yes', '--package', `${manager}@${version}`, '--', manager]
  const resolution = run(command, [...prefix, '--version'])
  const resolved = resolution.status === 0 ? resolution.stdout.trim() : undefined
  if (resolved !== version) {
    const diagnostic = [
      resolution.error?.message,
      resolution.signal ? `npm terminated by ${resolution.signal}` :
        resolution.status !== null && resolution.status !== 0 ? `npm exited with ${resolution.status}` : undefined,
      resolution.stderr?.trim(),
    ].filter(Boolean).join('\n')
    throw new Error(`Could not resolve declared ${manager}@${version}; received ${resolved ?? 'no version'}` +
      (diagnostic === '' ? '' : `\n${diagnostic}`), { cause: resolution.error })
  }
}

const result = run(command, [...prefix, 'install'], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
