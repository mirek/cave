/** The small part of mirek/ast used by the workspace projection. */
import { findPackageJSON } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type Origin = {
  readonly uri: string
  readonly revision?: string
  readonly range?: { readonly start: number, readonly end: number, readonly startLine?: number, readonly endLine?: number, readonly endColumn?: number }
}
export type Resource = { readonly id: string, readonly adapter: string, readonly uri: string, readonly revision?: string }
export type NodeId = { readonly adapter: string, readonly resource: string, readonly local: string }
export type Node = {
  readonly snapshot: { readonly id: NodeId, readonly kind: string, readonly attributes: Readonly<Record<string, unknown>>, readonly origin?: Origin }
  edges(request: { roles: readonly string[], signal?: AbortSignal }): AsyncIterable<{ to: NodeId }>
  resolve(id: NodeId, signal?: AbortSignal): Promise<Node | undefined>
}
export type Diagnostic = { readonly severity: string, readonly message: string, readonly code?: string }
export type Adapter = { readonly contractVersion: string, diagnostics(): readonly Diagnostic[] }
export type Query<T> = { iterate(options: { signal?: AbortSignal }): AsyncIterable<T> }
export type ModuleInfo = {
  readonly resource: Resource
  readonly mode: string
  readonly imports: readonly { readonly kind: string, readonly specifier: string, readonly typeOnly: boolean, readonly origin: Origin, readonly resolvedUri?: string }[]
  readonly exports: readonly { readonly name: string, readonly localName?: string, readonly typeOnly: boolean, readonly declarationKind?: string, readonly origin: Origin, readonly documentation?: string }[]
}
export type TypeScriptAdapter = Adapter & {
  read: { open(source: { uri: string }, context: { signal?: AbortSignal }): Promise<{ resource: Resource, close(): Promise<void> }> }
  moduleInfo(resource: Resource, context?: { signal?: AbortSignal }): Promise<ModuleInfo>
}
export type Runtime = {
  createJsonAdapter(): Adapter
  createFilesystemAdapter(options: { ignore: readonly string[] }): Adapter
  createTypeScriptAdapter(options: { project?: string }): TypeScriptAdapter
  select(adapter: Adapter, source: { uri: string }, selector: string): Query<Node>
  fromFilesystem(adapter: Adapter, source: { uri: string, include: readonly string[], kinds: readonly string[] }): Query<Node>
}

/** Load explicitly trusted local code; the module is not sandboxed. */
export const load = async (root: string, modulePath?: string): Promise<Runtime> => {
  let entry: string
  if (modulePath !== undefined) entry = resolve(modulePath)
  else {
    try {
      const manifestPath = findPackageJSON('@mirek/ast', pathToFileURL(resolve(root, '__cave_ast__.mjs')))
      if (!manifestPath) throw new Error('package not found')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { exports?: { '.'?: { import?: string } } }
      const imported = manifest.exports?.['.']?.import
      if (typeof imported !== 'string' || !imported.startsWith('./') || isAbsolute(imported)) throw new Error('unsupported package entry point')
      entry = resolve(dirname(manifestPath), imported)
    } catch (cause) {
      throw new Error('Cannot resolve @mirek/ast from the workspace. Install it there or pass --runtime <built-module.js>.', { cause })
    }
  }
  const runtime: unknown = await import(pathToFileURL(entry).href)
  if (runtime === null || typeof runtime !== 'object' ||
      !['createJsonAdapter', 'createFilesystemAdapter', 'createTypeScriptAdapter', 'select', 'fromFilesystem'].every(key => typeof (runtime as Record<string, unknown>)[key] === 'function')) {
    throw new TypeError('AST runtime does not expose the required adapter APIs')
  }
  return runtime as Runtime
}
