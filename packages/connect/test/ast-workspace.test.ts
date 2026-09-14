import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile, mkdir, symlink, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from '@cavelang/store'
import { query } from '@cavelang/query'
import { AstWorkspace } from '../src/index.ts'
import { runAst } from '../src/ast-main.ts'
import { PassThrough } from 'node:stream'

const runtime = process.env['CAVE_AST_MODULE']
test('real pnpm workspace extraction covers packages, dependencies, imports and JSDoc, then reconciles changes', { skip: !runtime }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cave-pnpm-'))
  await cp(fileURLToPath(new URL('../../../examples/pnpm-monorepo/', import.meta.url)), root, { recursive: true })
  const store = open()
  const options = { root, runtime, name: 'demo' }
  try {
    const report = await AstWorkspace.connect(store, options)
    assert.equal(report.failures.length, 0)
    assert.equal(query(store, '?p IS workspace-package').length, 3)
    assert.equal(query(store, '?f IS source-file').length, 3)
    assert.equal(query(store, '?d IS package-dependency').length, 4)
    assert.equal(query(store, '?d HAS range: "workspace:*"').length, 1)
    assert.equal(query(store, '?d HAS category: peerDependencies').length, 1)
    assert.equal(query(store, '?f IMPORTS repo/demo/file/packages/lib/src/index.ts').length, 2)
    assert.equal(query(store, '?f IMPORTS repo/demo/file/packages/app/src/local.ts').length, 1)
    const documented = query(store, '?f EXPORTS repo/demo/file/packages/lib/src/index.ts/export/greet')
    assert.equal(documented.length, 1)
    assert.match(documented[0]!.row!.comment!, /Greet a reader with `"Hello"`/)
    assert.match(documented[0]!.row!.comment!, /\n \* @param name/)
    assert.equal(query(store, 'repo/demo/file/packages/lib/src/index.ts/export/UserId HAS type-only: true').length, 1)
    const history = store.exportText({ tx: true })
    const repeat = await AstWorkspace.connect(store, options)
    assert.equal(repeat.added, 0)
    assert.equal(store.exportText({ tx: true }), history)

    const source = join(root, 'packages/app/src/index.ts')
    const original = await readFile(source, 'utf8')
    await writeFile(source, 'export function invalid( {\n')
    await assert.rejects(AstWorkspace.connect(store, options), /AST extraction failed/)
    assert.equal(store.exportText({ tx: true }), history)
    await writeFile(source, original.replace("import { reader } from './local.js'", '').replace('greet(reader)', "greet('Cave')"))
    await rm(join(root, 'packages/app/src/local.ts'))
    const manifestPath = join(root, 'packages/app/package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.optionalDependencies
    await writeFile(manifestPath, JSON.stringify(manifest))
    await AstWorkspace.connect(store, options)
    assert.equal(query(store, '?f IS source-file').length, 2)
    assert.equal(query(store, '?f IMPORTS repo/demo/file/packages/app/src/local.ts').length, 0)
    assert.equal(query(store, '?d HAS category: optionalDependencies').length, 0)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('workspace CLI resolves a project-installed runtime and previews without opening its database', { skip: !runtime }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cave-pnpm-cli-'))
  await cp(fileURLToPath(new URL('../../../examples/pnpm-monorepo/', import.meta.url)), root, { recursive: true })
  const stream = new PassThrough()
  let output = ''
  stream.setEncoding('utf8').on('data', text => { output += text })
  try {
    await mkdir(join(root, 'node_modules/@mirek'), { recursive: true })
    await symlink(dirname(dirname(runtime!)), join(root, 'node_modules/@mirek/ast'), 'junction')
    const db = join(root, 'untouched.db')
    assert.equal(await runAst([root, '--name', 'demo', '--db', db, '--dry-run'], { stdout: stream }), 0)
    await assert.rejects(access(db), { code: 'ENOENT' })
    assert.match(output, /EXPORTS .*export\/greet/)
    output = ''
    assert.equal(await runAst([root, '--name', 'demo', '--db', db, '--json'], { stdout: stream }), 0)
    assert.equal(JSON.parse(output).records, 19)
    await assert.rejects(runAst([root, '--max-records', '0'], { stdout: stream }), /positive safe integer/)
  } finally { stream.destroy(); await rm(root, { recursive: true, force: true }) }
})

test('workspace imports distinguish local aliases and Node builtins from npm packages', { skip: !runtime }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cave-pnpm-alias-'))
  await cp(fileURLToPath(new URL('../../../examples/pnpm-monorepo/', import.meta.url)), root, { recursive: true })
  const store = open()
  try {
    const configPath = join(root, 'tsconfig.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    config.compilerOptions.paths['utils/*'] = ['packages/lib/src/*.ts']
    await writeFile(configPath, JSON.stringify(config))
    await writeFile(join(root, 'packages/app/src/alias.ts'), 'import { greet } from "utils/index"; import "fs"; import "fs/promises"; export { greet };\n')
    await AstWorkspace.connect(store, { root, runtime, name: 'alias' })
    assert.equal(query(store, '?file USES npm/utils').length, 0)
    assert.equal(query(store, '?file USES npm/fs').length, 0)
    assert.equal(query(store, 'repo/alias/file/packages/app/src/alias.ts IMPORTS repo/alias/file/packages/lib/src/index.ts').length, 1)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('a workspace root without package.json retains member packages and workspace-owned sources', { skip: !runtime }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cave-pnpm-root-'))
  await cp(fileURLToPath(new URL('../../../examples/pnpm-monorepo/', import.meta.url)), root, { recursive: true })
  const store = open()
  try {
    await rm(join(root, 'package.json'))
    await writeFile(join(root, 'config.ts'), 'export const workspace = true;\n')
    await AstWorkspace.connect(store, { root, runtime, name: 'rootless' })
    assert.equal(query(store, '?p IS workspace-package').length, 2)
    assert.equal(query(store, '?f IS source-file').length, 4)
    assert.equal(query(store, 'repo/rootless CONTAINS repo/rootless/file/config.ts').length, 1)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})
