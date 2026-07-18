import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packages = join(root, 'packages')

const remove = path => rmSync(path, { force: true, recursive: true })

for (const entry of readdirSync(packages, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = join(packages, entry.name)
  remove(join(directory, 'dist'))
  remove(join(directory, 'License.md'))
  remove(join(directory, 'Authors.md'))
}

remove(join(root, 'editors/vscode/dist'))
remove(join(root, 'website/dist'))

for (const entry of readdirSync(join(root, 'editors/vscode'), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.vsix')) remove(join(root, 'editors/vscode', entry.name))
}

const removeBuildInfo = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) removeBuildInfo(path)
    else if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) remove(path)
  }
}

if (existsSync(root)) removeBuildInfo(root)
