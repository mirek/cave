import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyVsix } from './verify-vsix.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const output = join(root, `cave-language-${manifest.version}.vsix`)
const pnpm = process.env.npm_execpath

if (!pnpm) throw new Error('package.mjs must run through pnpm')

const result = spawnSync(process.execPath, [
  pnpm,
  'exec',
  'vsce',
  'package',
  '--no-dependencies',
  '--out',
  output,
], { cwd: root, stdio: 'inherit' })

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

await verifyVsix(output, manifest.version)
console.log(`validated ${output}`)
