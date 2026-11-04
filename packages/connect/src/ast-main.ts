import { parseArgs } from 'node:util'
import { defaultDbPath, open, openAt } from '@cavelang/store'
import * as Workspace from './ast-workspace.ts'

const usage = `cave ast — ingest a pnpm workspace through mirek/ast

Usage:
  cave ast <root> [--db <path>] [--runtime <built-module.js>] [options]

Extract workspace packages, dependency categories/ranges, source-file ownership,
static imports/re-exports, and exported declarations with JSDoc comments.
pnpm must be on PATH. It discovers workspace membership without installing.
AST is resolved from the workspace, or loaded from the explicit --runtime file.
The runtime is trusted executable code. Source documents are only read.

Every successful pass reconciles this workspace's owned claims, including
removed dependencies/files. Extraction or mapping errors leave history intact.
File imports resolve through the nearest tsconfig.json; files outside a project
remain syntax-only. Dynamic import/require calls are not inventoried.

Options:
  --db <path>          knowledge database (default: $CAVE_DB, or cave.db)
  --runtime <path>     built mirek/ast entry module (resolved from current directory)
  --name <name>        logical workspace namespace (default: root basename + path digest)
  --exclude <glob>     extra source exclusion; repeatable
  --max-records <n>    reject inventories exceeding this bound (default: 100000)
  --force             refresh even unchanged mapped records
  --dry-run           export a complete preview from memory; do not open --db
  --json              emit the connector report as JSON (incompatible with --dry-run)
  --help              show this help

Sources exclude node_modules, .git, .tmp, dist, build and coverage directories.
Named tsconfig project references are not loaded transitively by AST; its
warnings are printed. Package dependency ranges remain exactly as authored.

Example:
  cave ast . --runtime ../ast/packages/core/dist/index.js --db repo.db
  cave query --db repo.db '?p IS workspace-package'
  cave query --db repo.db '?file IMPORTS ?dependency'
  cave query --db repo.db '?file EXPORTS ?symbol'
`

export type Context = {
  readonly stdout?: NodeJS.WritableStream
  readonly stderr?: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

export const runAst = async (args: readonly string[], context: Context = {}): Promise<number> => {
  const { values, positionals } = parseArgs({ args: [...args], allowPositionals: true, options: {
    db: { type: 'string' }, runtime: { type: 'string' }, name: { type: 'string' },
    exclude: { type: 'string', multiple: true }, 'max-records': { type: 'string' },
    force: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  } })
  const stdout = context.stdout ?? process.stdout
  if (values.help) { stdout.write(usage); return 0 }
  if (positionals.length !== 1) throw new Error('cave ast requires one pnpm workspace root; see cave ast --help')
  if (values.json && values['dry-run']) throw new Error('--json cannot be combined with --dry-run')
  const maxRecords = values['max-records'] === undefined ? undefined : Number(values['max-records'])
  if (maxRecords !== undefined && (!Number.isSafeInteger(maxRecords) || maxRecords < 1)) throw new Error('--max-records must be a positive safe integer')
  if (values.name !== undefined && values.name.trim() === '') throw new Error('--name must not be empty')
  const signal = context.signal
  signal?.throwIfAborted()
  const store = values['dry-run'] ? open() : openAt(values.db ?? defaultDbPath(), { intent: 'write' })
  let output: string
  let warnings = ''
  try {
    const report = await Workspace.connect(store, { root: positionals[0]!, runtime: values.runtime, name: values.name, exclude: values.exclude, force: values.force, maxRecords, signal })
    warnings = report.diagnostics.filter(item => item.severity === 'warning').map(item => `ast warning${item.code ? ` (${item.code})` : ''}: ${item.message}\n`).join('')
    output = values['dry-run'] ? store.exportText() : values.json ? JSON.stringify(report) + '\n' :
      `ast: ${report.records} record(s), ${report.mapped} mapped, ${report.skipped} unchanged; +${report.added} claim(s), ${report.retracted} retracted, ${report.pruned} pruned\n`
  } catch (error) {
    try { store.close() } catch (closeError) { throw new AggregateError([error, closeError], 'AST ingestion failed and store cleanup failed', { cause: error }) }
    throw error
  }
  store.close()
  if (warnings) (context.stderr ?? process.stderr).write(warnings)
  stdout.write(output)
  return 0
}
