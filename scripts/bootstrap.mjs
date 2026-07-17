import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { packageManager } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const match = /^(pnpm)@(\d+\.\d+\.\d+)$/.exec(packageManager ?? '')

if (!match) {
  throw new Error(`package.json must declare an exact pnpm packageManager version; received ${packageManager ?? 'nothing'}`)
}

const [, manager, version] = match

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: root,
  encoding: 'utf8',
  ...options,
})

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
  const resolved = availableVersion(command, [...prefix, '--version'])
  if (resolved !== version) {
    throw new Error(`Could not resolve declared ${manager}@${version}; received ${resolved ?? 'no version'}`)
  }
}

const result = run(command, [...prefix, 'install'], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
