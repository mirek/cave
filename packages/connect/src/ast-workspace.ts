/** pnpm package discovery plus adapter-owned JSON and TypeScript extraction. */
import { createHash } from 'node:crypto'
import { access, realpath } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { directCommand, runProcess } from '@cavelang/loop'
import type { Store } from '@cavelang/store'
import * as Ast from './ast.ts'
import * as Runtime from './ast-runtime.ts'
import * as Template from './template.ts'

export type Options = {
  readonly root: string
  readonly name?: string
  readonly runtime?: string
  readonly signal?: AbortSignal
  readonly maxRecords?: number
  readonly force?: boolean
  /** Extra filesystem ignore globs; defaults always exclude dependencies and build output. */
  readonly exclude?: readonly string[]
}

export const mappingText = `
IMPORTS IS verb
IMPORTS REVERSE IMPORTED-BY
EXPORTS IS verb
EXPORTS REVERSE EXPORTED-BY
DECLARES IS verb
DECLARES REVERSE DECLARED-BY
?repo IS pnpm-workspace
?repo HAS path: ?root
?repo CONTAINS ?member
?package IS workspace-package
?package HAS name: ?packageName
?package HAS version: ?version
?package HAS private: ?private
?package HAS path: ?packagePath
?depOwner USES ?depTarget
?depOwner CONTAINS ?dependency
?dependency IS package-dependency
?dependency NEEDS ?depTarget
?dependency HAS category: ?category
?dependency HAS range: ?range
?owner CONTAINS ?file
?file IS source-file
?file HAS path: ?filePath
?file HAS analysis-mode: ?mode
?file HAS revision: ?revision
?importer IMPORTS ?targetFile
?importer USES ?targetPackage
?importer CONTAINS ?import
?import IS module-import
?import HAS specifier: ?specifier
?import HAS kind: ?importKind
?import HAS type-only: ?importTypeOnly
?exporter EXPORTS ?symbol
?symbol IS exported-symbol
?symbol HAS name: ?exportName
?symbol HAS local-name: ?localName
?symbol HAS kind: ?declarationKind
?symbol HAS type-only: ?exportTypeOnly
?symbol HAS declaration-source: ?declarationSource
?declarationFile DECLARES ?symbol
`
const mapping = Template.parse(mappingText).mapping!
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
const slash = (path: string): string => path.split(sep).join('/')
const encoded = (value: string): string => value.split('/').map(encodeURIComponent).join('/')
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const barePackage = (specifier: string): string | undefined => {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') || specifier.includes(':')) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.length >= 2 ? parts.slice(0, 2).join('/') : undefined : parts[0]
}
const children = async (node: Runtime.Node, signal?: AbortSignal): Promise<Runtime.Node[]> => {
  const result: Runtime.Node[] = []
  for await (const edge of node.edges({ roles: ['child'], signal })) {
    signal?.throwIfAborted()
    const child = await node.resolve(edge.to, signal)
    if (!child) throw new Error('AST returned a missing JSON child')
    result.push(child)
  }
  return result
}
const propertyValue = async (node: Runtime.Node, signal?: AbortSignal): Promise<Runtime.Node> => {
  const nodes = await children(node, signal)
  if (nodes.length !== 1) throw new Error('Expected one JSON property value')
  return nodes[0]!
}
const span = (origin?: Runtime.Origin): Ast.Record['span'] => {
  const range = origin?.range
  if (range?.startLine === undefined || range.endLine === undefined) return undefined
  return { startLine: range.startLine + 1, endLine: Math.max(range.startLine + 1, range.endLine + (range.endColumn === 0 && range.end > range.start ? 0 : 1)) }
}
const record = (key: string, data: Record<string, unknown>, source: string, origin?: Runtime.Origin, comment?: string): Ast.Record =>
  ({ data: { key: digest(key), ...data }, source, span: span(origin), ...(comment === undefined ? {} : { comment }) })

/** Discover only; pnpm owns workspace membership and no install is performed. */
const packagePaths = async (root: string, signal?: AbortSignal): Promise<string[]> => {
  await access(join(root, 'pnpm-workspace.yaml'))
  // Windows pnpm shims are batch files. Keep the shell input constant; the
  // caller's root is passed only as cwd, never interpolated into the command.
  const command = process.platform === 'win32' ?
    directCommand(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm list --recursive --depth -1 --json']) :
    directCommand('pnpm', ['list', '--recursive', '--depth', '-1', '--json'])
  const result = await runProcess(command, {
    cwd: root, signal, timeoutMs: 60_000, strictStdoutUtf8: true,
    env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: '0' }
  })
  if (result.code !== 0) throw new Error(`pnpm workspace discovery failed (exit ${result.code}): ${result.stderr.trim()}`)
  const rows: unknown = JSON.parse(result.stdout)
  if (!Array.isArray(rows)) throw new TypeError('pnpm list must return an array')
  const paths = new Set<string>()
  try { await access(join(root, 'package.json')); paths.add(root) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  for (const row of rows) {
    if (!row || typeof row.path !== 'string') throw new TypeError('pnpm list returned a package without a path')
    const path = await realpath(row.path)
    if (!inside(root, path)) throw new Error(`pnpm package is outside the workspace: ${path}`)
    paths.add(path)
  }
  return [...paths].sort()
}

const projectFor = async (file: string, root: string): Promise<string | undefined> => {
  for (let dir = dirname(file); inside(root, dir); dir = dirname(dir)) {
    const config = join(dir, 'tsconfig.json')
    try { await access(config); return config }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (dir === root) break
  }
  return undefined
}

/** A fresh adapter set is created for each refresh; no stale compiler cache crosses runs. */
export const extract = async (options: Options): Promise<{ query: Ast.Query, name: string, diagnostics: () => readonly Runtime.Diagnostic[] }> => {
  const signal = options.signal
  signal?.throwIfAborted()
  const root = await realpath(resolve(options.root))
  const name = options.name ?? `${basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`
  const prefix = `repo/${encoded(name)}`
  const exclude = [...(options.exclude ?? [])]
  const runtime = await Runtime.load(root, options.runtime)
  const json = runtime.createJsonAdapter()
  const fs = runtime.createFilesystemAdapter({ ignore: ['**/node_modules/**', '**/.git/**', '**/.tmp/**', '**/dist/**', '**/build/**', '**/coverage/**', ...exclude] })
  const adapters: Runtime.Adapter[] = [json, fs]
  const diagnostics = () => adapters.flatMap(adapter => adapter.diagnostics())
  const fileId = (path: string) => `${prefix}/file/${encoded(slash(relative(root, path)))}`
  const query: Ast.Query = { iterate: ({ signal: iterationSignal }) => ({ async *[Symbol.asyncIterator]() {
    const activeSignal = iterationSignal ?? signal
    const paths = await packagePaths(root, activeSignal)
    const packages = new Map<string, { id: string, name: string }>()
    const byName = new Map<string, string>()
    const pendingDependencies: Ast.Record[] = []
    yield record('workspace', { repo: prefix, root }, pathToFileURL(join(root, 'pnpm-workspace.yaml')).href)
    for (const path of paths) {
      activeSignal?.throwIfAborted()
      const manifestPath = join(path, 'package.json')
      const source = pathToFileURL(manifestPath).href
      const fields = new Map<string, unknown>()
      const dependencies: { category: string, dependencyName: string, range: string, origin?: Runtime.Origin }[] = []
      let objects = 0
      for await (const object of runtime.select(json, { uri: manifestPath }, 'json::root > json::object').iterate({ signal: activeSignal })) {
        objects++
        for (const property of await children(object, activeSignal)) {
          const key = property.snapshot.attributes['name']
          if (typeof key !== 'string' || fields.has(key)) throw new Error(`Invalid or duplicate manifest field in ${manifestPath}`)
          const value = await propertyValue(property, activeSignal)
          fields.set(key, value.snapshot.attributes['value'])
          if (['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].includes(key)) {
            if (value.snapshot.kind !== 'json::object') throw new Error(`${key} must be an object in ${manifestPath}`)
            const seen = new Set<string>()
            for (const dependency of await children(value, activeSignal)) {
              const dependencyName = dependency.snapshot.attributes['name']
              const range = (await propertyValue(dependency, activeSignal)).snapshot.attributes['value']
              if (typeof dependencyName !== 'string' || typeof range !== 'string' || seen.has(dependencyName)) throw new Error(`Invalid dependency in ${manifestPath}`)
              seen.add(dependencyName)
              dependencies.push({ category: key, dependencyName, range, origin: dependency.snapshot.origin })
            }
          }
        }
      }
      if (objects !== 1) throw new Error(`Manifest must be a JSON object: ${manifestPath}`)
      if (json.diagnostics().some(diagnostic => diagnostic.severity === 'error')) throw new Error(`Invalid JSON manifest: ${manifestPath}`)
      const value = (key: string) => fields.get(key)
      const packageName = value('name') ?? (path === root ? basename(root) : slash(relative(root, path)))
      if (typeof packageName !== 'string' || !packageName.trim() || byName.has(packageName)) throw new Error(`Missing or duplicate package name in ${manifestPath}`)
      const id = `${prefix}/pkg/${encoded(packageName)}`
      packages.set(path, { id, name: packageName }); byName.set(packageName, id)
      yield record(`package/${slash(relative(root, path))}`, { repo: prefix, member: id, package: id, packageName, version: value('version'), private: value('private'), packagePath: slash(relative(root, path)) || '.' }, source)
      for (const { category, dependencyName, range, origin } of dependencies) {
        const dependency = `${id}/dependency/${category}/${encoded(dependencyName)}`
        pendingDependencies.push(record(dependency, { depOwner: id, dependency, dependencyName, category, range }, source, origin))
      }
    }
    for (const dependency of pendingDependencies) {
      const depName = dependency.data['dependencyName'] as string
      yield { ...dependency, data: { ...dependency.data, depTarget: byName.get(depName) ?? `npm/${encoded(depName)}` } }
    }
    const projects = new Map<string, Runtime.TypeScriptAdapter>()
    const ownership = [...packages.entries()].sort(([a], [b]) => b.length - a.length)
    for await (const node of runtime.fromFilesystem(fs, { uri: root, include: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'], kinds: ['fs::file'] }).iterate({ signal: activeSignal })) {
      activeSignal?.throwIfAborted()
      const origin = node.snapshot.origin
      if (!origin) throw new Error('AST source file has no physical origin')
      const path = fileURLToPath(origin.uri)
      if (!inside(root, path)) throw new Error('AST source file is outside the workspace')
      const owner = ownership.find(([dir]) => inside(dir, path))?.[1] ?? { id: prefix }
      const project = await projectFor(path, root)
      let ts = projects.get(project ?? '')
      if (!ts) {
        ts = runtime.createTypeScriptAdapter({ project })
        if (ts.contractVersion !== '1' || typeof ts.moduleInfo !== 'function') throw new Error('AST runtime requires TypeScript moduleInfo support (mirek/ast PR #30 or later)')
        projects.set(project ?? '', ts); adapters.push(ts)
      }
      const handle = await ts.read.open({ uri: path }, { signal: activeSignal })
      let info: Runtime.ModuleInfo
      try { info = await ts.moduleInfo(handle.resource, { signal: activeSignal }) }
      finally { await handle.close() }
      const file = fileId(path)
      yield record(file, { owner: owner.id, file, filePath: slash(relative(root, path)), mode: info.mode, revision: info.resource.revision }, origin.uri)
      const occurrences = new Map<string, number>()
      for (const imported of info.imports) {
        const key = `${imported.kind}/${encoded(imported.specifier)}`
        const at = occurrences.get(key) ?? 0; occurrences.set(key, at + 1)
        const target = imported.resolvedUri?.startsWith('file:') ? fileURLToPath(imported.resolvedUri) : undefined
        const localTarget = target && inside(root, target) && !slash(relative(root, target)).split('/').includes('node_modules') ? fileId(target) : undefined
        const packageName = barePackage(imported.specifier)
        const targetPackage = packageName && !isBuiltin(imported.specifier) ?
          localTarget ? ownership.find(([dir]) => inside(dir, target!))?.[1].id :
            byName.get(packageName) ?? `npm/${encoded(packageName)}` : undefined
        const id = `${file}/import/${key}/${at}`
        yield record(id, { importer: file, import: id, targetFile: localTarget, targetPackage, specifier: imported.specifier, importKind: imported.kind, importTypeOnly: imported.typeOnly }, imported.origin.uri, imported.origin)
      }
      for (const exported of info.exports) {
        const symbol = `${file}/export/${encoded(exported.name)}`
        const declaration = exported.origin.uri.startsWith('file:') ? fileURLToPath(exported.origin.uri) : undefined
        yield record(symbol, { exporter: file, symbol, exportName: exported.name, localName: exported.localName, declarationKind: exported.declarationKind, exportTypeOnly: exported.typeOnly, declarationSource: exported.origin.uri, declarationFile: declaration && inside(root, declaration) ? fileId(declaration) : undefined }, info.resource.uri, undefined, exported.documentation)
      }
    }
  } }) }
  return { query, name, diagnostics }
}

/** Refresh the selected workspace's complete owned inventory, including removals. */
export const connect = async (store: Store, options: Options) => {
  const captured = { ...options, exclude: options.exclude === undefined ? undefined : [...options.exclude] }
  const extracted = await extract(captured)
  const report = await Ast.connect(store, mapping, extracted.query, { name: `ast-${digest(extracted.name)}`, key: 'key', prune: true, force: captured.force, maxRecords: captured.maxRecords, signal: captured.signal, diagnostics: extracted.diagnostics })
  return { ...report, diagnostics: extracted.diagnostics() }
}
