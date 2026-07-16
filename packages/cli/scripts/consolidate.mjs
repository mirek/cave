#!/usr/bin/env node
/** Build the private command modules into @cavelang/cli's published dist. */

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const packageDir = join(import.meta.dirname, '..')
const packagesDir = join(packageDir, '..')
const outputDir = join(packageDir, 'dist', 'internal')
const internal = [
  'act', 'automate', 'connect', 'eval', 'ingest', 'loop',
  'mcp', 'rules', 'shape', 'sync', 'view'
]

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })
for (const name of internal) {
  cpSync(join(packagesDir, name, 'dist', 'src'), join(outputDir, name), { recursive: true })
}

const rewrite = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      rewrite(path)
      continue
    }
    if (!path.endsWith('.js') && !path.endsWith('.d.ts')) continue
    let text = readFileSync(path, 'utf8')
    for (const name of internal) {
      text = text.replaceAll(`@cavelang/${name}`, `@cavelang/cli/${name}`)
    }
    writeFileSync(path, text)
  }
}

rewrite(join(packageDir, 'dist', 'src'))
rewrite(outputDir)
