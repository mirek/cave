import { readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'website/dist')
const files = []
const visit = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else files.push(path)
  }
}
visit(dist)

const forbiddenNames = files.filter(path => /(?:^|[-_.])z3(?:[-_.]|$)|solver-z3/i.test(relative(dist, path)))
// The docs legitimately name the optional backend. Runtime inclusion would
// produce a separately loadable Z3 chunk/asset or a payload near its 34 MB
// Wasm size, so inspect physical delivery rather than prose bytes.
const oversizedRuntime = files.filter(path =>
  ['.js', '.wasm'].includes(extname(path)) && statSync(path).size > 10_000_000)

const failures = [...new Set([...forbiddenNames, ...oversizedRuntime])]
if (failures.length > 0) {
  process.stderr.write(`default website includes optional solver artifacts:\n${failures.map(path => `  ${relative(dist, path)}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`website bundle excludes optional solver assets (${files.length} files checked)\n`)
