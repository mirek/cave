import { copyFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageDir = process.cwd()
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))

if (manifest.private === true) {
  throw new Error(`refusing to stage legal files for private package ${manifest.name ?? packageDir}`)
}

for (const file of ['License.md', 'Authors.md']) {
  copyFileSync(join(root, file), join(packageDir, file))
}
